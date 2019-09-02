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

/**
 * This script will allow you to migrate your NeDB database
 * to a postgres one.
 */

import { Logging, MatrixUser, UserBridgeStore, RoomBridgeStore, EventBridgeStore } from "matrix-appservice-bridge";
import * as NeDB from "nedb";
import * as path from "path";
import { promisify } from "util";
import { NedbDatastore } from "../datastore/NedbDatastore";
import { PgDatastore } from "../datastore/postgres/PgDatastore";
import { BridgedRoom } from "../BridgedRoom";
import { SlackGhost } from "../SlackGhost";

Logging.configure({ console: "info" });
const log = Logging.get("script");

async function main() {
    const POSTGRES_URL = process.argv[2];
    if (!POSTGRES_URL) {
        log.error("You must specify the postgres url (ex: postgresql://user:pass@host/database");
        throw Error("");
    }
    const pgres = new PgDatastore(POSTGRES_URL);
    await pgres.ensureSchema();
    const NEDB_DIRECTORY = process.argv[3] || "";

    const config = {
        autoload: false,
    };

    const teamStore = new NeDB({ filename: path.join(NEDB_DIRECTORY, "teams.db"), ...config});
    const roomStore = new NeDB({ filename: path.join(NEDB_DIRECTORY, "room-store.db"), ...config});
    const userStore = new NeDB({ filename: path.join(NEDB_DIRECTORY, "user-store.db"), ...config});
    const eventStore = new NeDB({ filename: path.join(NEDB_DIRECTORY, "event-store.db"), ...config});

    try {
        await promisify(teamStore.loadDatabase).bind(teamStore)();
        await promisify(roomStore.loadDatabase).bind(roomStore)();
        await promisify(userStore.loadDatabase).bind(userStore)();
        await promisify(eventStore.loadDatabase).bind(eventStore)();
    } catch (ex) {
        log.error("Couldn't load datastores");
        log.error("Ensure you have given the correct path to the database.");
        throw ex;
    }

    const nedb = new NedbDatastore(
        new UserBridgeStore(userStore),
        new RoomBridgeStore(roomStore),
        new EventBridgeStore(eventStore),
        teamStore,
    );
    const allRooms = await nedb.getAllRooms();
    const allEvents = await nedb.getAllEvents();
    const allTeams = await nedb.getAllTeams();
    const allSlackUsers = await nedb.getAllUsers(false);
    const allMatrixUsers = await nedb.getAllUsers(true);

    log.info(`Migrating ${allRooms.length} rooms`);
    log.info(`Migrating ${allTeams.length} teams`);
    log.info(`Migrating ${allEvents.length} events`);
    log.info(`Migrating ${allSlackUsers.length} slack users`);
    log.info(`Migrating ${allMatrixUsers.length} matrix users`);
    const roomMigrations = allRooms.map(async (room, i) => {
        // tslint:disable-next-line: no-any
        await pgres.upsertRoom(BridgedRoom.fromEntry(null as any, room));
        log.info(`Migrated room ${room.id} (${i + 1}/${allRooms.length})`);
    });

    const eventMigrations = allEvents.map(async (event, i) => {
        await pgres.upsertEvent(event);
        log.info(`Migrated event ${event.eventId} ${event.slackTs} (${i + 1}/${allEvents.length})`);
    });

    const teamMigrations = allTeams.map(async (team, i) => {
        await pgres.upsertTeam(team.team_id, team.bot_token, team.team_name, team.user_id);
        log.info(`Migrated team ${team.team_id} ${team.team_name} (${i + 1}/${allTeams.length})`);
    });

    const slackUserMigrations = allSlackUsers.map(async (user, i) => {
        // tslint:disable-next-line: no-any
        const ghost = SlackGhost.fromEntry(null as any, user, null);
        await pgres.upsertUser(ghost);
        log.info(`Migrated slack user ${user.id} (${i + 1}/${allSlackUsers.length})`);
    });

    const matrixUserMigrations = allMatrixUsers.map(async (user, i) => {
        const mxUser = new MatrixUser(user.id, user);
        // tslint:disable-next-line: no-any
        await pgres.storeMatrixUser(mxUser);
        log.info(`Migrated matrix user ${mxUser.getId()} (${i + 1}/${allMatrixUsers.length})`);
    });

    try {
        await Promise.all(
            roomMigrations.concat(
                eventMigrations,
                teamMigrations,
                slackUserMigrations,
                matrixUserMigrations,
            ),
        );
        log.info("Completed migration");
    } catch (ex) {
        log.error("An error occured while migrating databases:");
        log.error(ex);
        log.error("Your existing databases have not been modified, but you may need to drop the postgres table and start over");
    }
}

main().then(() => {
    log.info("finished");
}).catch((err) => {
    log.error("failed:", err);
});
