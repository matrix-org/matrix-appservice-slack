/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
// tslint thinks we can combine these two statements, but so far I have been unable to.
import * as pgInit from "pg-promise";
// tslint:disable-next-line: no-duplicate-imports
import { IDatabase, IMain } from "pg-promise";

import { Logging, MatrixUser } from "matrix-appservice-bridge";
import { Datastore, TeamEntry, RoomEntry, UserEntry, EventEntry, EventEntryExtra, PuppetEntry } from "../Models";
import { BridgedRoom } from "../../BridgedRoom";
import { SlackGhost } from "../../SlackGhost";

const pgp: IMain = pgInit({
    // Initialization Options
});

const log = Logging.get("PgDatastore");

export class PgDatastore implements Datastore {
    public static readonly LATEST_SCHEMA = 3;
    // tslint:disable-next-line: no-any
    public readonly postgresDb: IDatabase<any>;

    constructor(connectionString: string) {
        this.postgresDb = pgp(connectionString);
    }

    public async upsertUser(user: SlackGhost): Promise<void> {
        const entry = user.toEntry();
        log.debug(`upsertUser: ${entry.id}`);
        await this.postgresDb.none("INSERT INTO users VALUES(${id}, true, ${this}) ON CONFLICT (userId) DO UPDATE SET json = ${this}", entry);
    }

    public async getUser(id: string): Promise<UserEntry | null> {
        const dbEntry = await this.postgresDb.oneOrNone("SELECT * FROM users WHERE userId = ${id}", { id });
        if (!dbEntry) {
            return null;
        }
        return JSON.parse(dbEntry.json);
    }

    public async getMatrixUser(userId: string): Promise<MatrixUser|undefined> {
        userId = new MatrixUser(userId).getId(); // Ensure ID correctness
        const userData = await this.getUser(userId);
        return userData !== null ? new MatrixUser(userId, userData) : null;
    }

    public async getAllUsersForTeam(teamId: string): Promise<UserEntry[]> {
        return this.postgresDb.map<UserEntry>("SELECT json FROM users WHERE json::json->>'team_id' = ${teamId}", {
            teamId,
        }, dbEntry => JSON.parse(dbEntry.json) as UserEntry);
    }

    public async storeMatrixUser(user: MatrixUser): Promise<void> {
        log.debug(`storeMatrixUser: ${user.getId()}`);
        await this.postgresDb.none("INSERT INTO users VALUES(${getId}, false, ${serialize}) ON CONFLICT (userId) DO UPDATE SET json = ${serialize}", user);
    }

    public async upsertEvent(roomIdOrEntry: string|EventEntry, eventId?: string, channelId?: string, ts?: string, extras?: EventEntryExtra) {
        let entry: EventEntry = roomIdOrEntry as EventEntry;
        if (typeof(roomIdOrEntry) === "string") {
            entry = {
                roomId: roomIdOrEntry as string,
                eventId: eventId!,
                slackChannelId: channelId!,
                slackTs: ts!,
                _extras: extras || {},
            };
        }
        log.debug(`upsertEvent: ${entry.roomId} ${entry.eventId} ${entry.slackChannelId} ${entry.slackTs}`);
        await this.postgresDb.none("INSERT INTO events VALUES(${roomId}, ${eventId}, ${slackChannelId}, ${slackTs}, ${jsonExtras}) " +
                           "ON CONFLICT ON CONSTRAINT cons_events_unique DO UPDATE SET extras = ${jsonExtras}", {
            ...entry,
            jsonExtras: JSON.stringify(entry._extras),
        });
    }

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry|null> {
        const dbEntry = await this.postgresDb.oneOrNone(
            "SELECT * FROM events WHERE roomId = ${roomId} AND eventId = ${eventId}",
            { roomId, eventId });
        if (!dbEntry) {
            return null;
        }
        return {
            roomId,
            eventId,
            slackChannelId: dbEntry.slackchannel,
            slackTs: dbEntry.slackts,
            _extras: JSON.parse(dbEntry.extras),
        };
    }

    public async getEventBySlackId(slackChannel: string, slackTs: string): Promise<EventEntry|null> {
        const dbEntry = await this.postgresDb.oneOrNone(
            "SELECT * FROM events WHERE slackChannel = ${slackChannel} AND slackTs = ${slackTs}",
            { slackChannel, slackTs });
        if (!dbEntry) {
            return null;
        }
        return {
            roomId: dbEntry.roomid,
            eventId: dbEntry.eventid,
            slackChannelId: slackChannel,
            slackTs,
            _extras: JSON.parse(dbEntry.extras),
        };
    }

    public async ensureSchema() {
        let currentVersion = await this.getSchemaVersion();
        while (currentVersion < PgDatastore.LATEST_SCHEMA) {
            log.info(`Updating schema to v${currentVersion + 1}`);
            const runSchema = require(`./schema/v${currentVersion + 1}`).runSchema;
            try {
                await runSchema(this.postgresDb);
                currentVersion++;
                await this.updateSchemaVersion(currentVersion);
            } catch (ex) {
                log.warn(`Failed to run schema v${currentVersion + 1}:`, ex);
                throw Error("Failed to update database schema");
            }
        }
        log.info(`Database schema is at version v${currentVersion}`);
    }

    public async upsertRoom(room: BridgedRoom) {
        const entry = room.toEntry();
        log.debug(`upsertRoom: ${entry.id}`);
        await this.postgresDb.none("INSERT INTO rooms VALUES(${id}, ${matrix_id}, ${remote_id}, ${remote:json}) ON CONFLICT (id) DO UPDATE SET json = ${remote:json}", entry);
    }

    public async deleteRoom(id: string) {
        log.debug(`deleteRoom: ${id}`);
        await this.postgresDb.none("DELETE FROM rooms WHERE id = ${id}", { id });
    }

    public async getAllRooms() : Promise<RoomEntry[]> {
        return this.postgresDb.map<RoomEntry>("SELECT * FROM rooms", [], r => {
            const remote = JSON.parse(r.json);
            return {
                id: r.id,
                matrix_id: r.roomid,
                remote,
                remote_id: r.remoteid,
            } as RoomEntry;            
        });
    }

    public async upsertTeam(entry: TeamEntry) {
        log.debug(`upsertTeam: ${entry.id} ${entry.name}`);
        const props = {
            id: entry.id,
            name: entry.name,
            token: entry.bot_token,
            bot_id: entry.bot_id,
            domain: entry.domain,
            scopes: entry.scopes,
            status: entry.status,
            user_id: entry.user_id,
        };
        const statement = PgDatastore.BuildUpsertStatement("teams", "id", props);
        await this.postgresDb.oneOrNone(statement, props);
    }

    // tslint:disable-next-line: no-any
    private static teamEntryForRow(doc: any) {
       return {
            id: doc.id,
            name: doc.name,
            bot_token: doc.token,
            user_id: doc.user_id,
            bot_id: doc.bot_id,
            domain: doc.domain,
            scopes: doc.scopes,
            status: doc.status,
        } as TeamEntry;
    }

    public async getTeam(teamId: string): Promise<TeamEntry|null> {
        const doc = await this.postgresDb.oneOrNone("SELECT * FROM teams WHERE id = ${teamId}", { teamId });
        if (doc === null) {
            return null;
        }
        return PgDatastore.teamEntryForRow(doc);
    }

    public async getAllTeams(): Promise<TeamEntry[]> {
        return this.postgresDb.map<TeamEntry>("SELECT * FROM teams", [], PgDatastore.teamEntryForRow));
    }

    public async setPuppetToken(teamId: string, slackUser: string, matrixId: string, token: string): Promise<void> {
        await this.postgresDb.none("INSERT INTO puppets VALUES (${slackUser}, ${teamId}, ${matrixId}, ${token})" +
                                        "ON CONFLICT ON CONSTRAINT cons_puppets_uniq DO UPDATE SET token = ${token}", {
            teamId,
            slackUser,
            matrixId,
            token,
        });
    }

    public async removePuppetTokenByMatrixId(teamId: string, matrixId: string) {
        await this.postgresDb.none("DELETE FROM puppets WHERE slackteam = ${teamId} " +
                                                    "AND matrixuser = ${matrixId}", { teamId, matrixId });
    }

    public async getPuppetTokenBySlackId(teamId: string, slackId: string): Promise<string|null> {
        const res = await this.postgresDb.oneOrNone("SELECT token FROM puppets WHERE slackteam = ${teamId} " +
                                                    "AND slackuser = ${slackId}", { teamId, slackId });
        return res ? res.token : null;
    }

    public async getPuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<string> {
        const res = await this.postgresDb.oneOrNone(
            "SELECT token FROM puppets WHERE slackteam = ${teamId} AND matrixuser = ${matrixId}",
            { teamId, matrixId },
        );
        return res ? res.token : null;
    }

    public async getPuppetsByMatrixId(userId: string): Promise<PuppetEntry[]> {
        return this.postgresDb.map<PuppetEntry>("SELECT * FROM puppets WHERE matrixuser = ${userId}", { userId }, u => {
            return {
                matrixId: u.matrixuser,
                teamId: u.slackteam,
                slackId: u.slackuser,
                token: u.token,
            } as PuppetEntry;
        });
    }

    public async getPuppetedUsers(): Promise<PuppetEntry[]> {
        return this.postgresDb.map<PuppetEntry>("SELECT * FROM puppets", [], u => {
            return {
                    matrixId: u.matrixuser,
                    teamId: u.slackteam,
                    slackId: u.slackuser,
                    token: u.token,
            } as PuppetEntry;
        });
    }

    private async updateSchemaVersion(version: number) : Promise<void> {
        log.debug(`updateSchemaVersion: ${version}`);
        await this.postgresDb.none("UPDATE schema SET version = ${version};", {version});
    }

    private async getSchemaVersion(): Promise<number> {
        try {
            const { version } = await this.postgresDb.one("SELECT version FROM SCHEMA");
            return version;
        } catch (ex) {
            if (ex.code === "42P01") { // undefined_table
                log.warn("Schema table could not be found");
                return 0;
            }
            log.error("Failed to get schema version:", ex);
        }
        throw Error("Couldn't fetch schema version");
    }

    private static BuildUpsertStatement(table: string, conflictKey: string, keyValues: {[key: string]: string}) {
        const keys = Object.keys(keyValues).join(", ");
        const keysValues = `\${${Object.keys(keyValues).join("}, ${")}}`;
        // tslint:disable-next-line: prefer-template
        const keysSets = Object.keys(keyValues).slice(1).map((k) => `${k} = \${${k}}`).join(", ");
        return `INSERT INTO ${table} (${keys}) VALUES (${keysValues}) ON CONFLICT (${conflictKey}) DO UPDATE SET ${keysSets}`;
    }
}
