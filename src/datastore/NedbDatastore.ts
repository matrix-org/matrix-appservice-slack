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
import { BridgedRoom } from "../BridgedRoom";
import { SlackGhost } from "../SlackGhost";
import {
    MatrixUser,
    EventStore, RoomStore, UserStore,
    StoredEvent } from "matrix-appservice-bridge";
import { Datastore, UserEntry, RoomEntry, RoomType, TeamEntry, EventEntry, EventEntryExtra, PuppetEntry } from "./Models";
import * as NedbDb from "nedb";

export class NedbDatastore implements Datastore {
    constructor(
        private readonly userStore: UserStore,
        private readonly roomStore: RoomStore,
        private readonly eventStore: EventStore,
        private readonly teamStore: NedbDb) {
    }

    public async upsertUser(user: SlackGhost) {
        const entry = user.toEntry();
        return this.userStore.upsert({id: entry.id}, entry);
    }

    public async getUser(id: string): Promise<UserEntry|null> {
        const users = await this.userStore.select({id});
        if (!users || users.length === 0) {
            return null;
        }
        // We do not use the _id for anything.
        delete users[0]._id;
        return users[0];
    }

    public async getAllUsers(matrixUsers: boolean): Promise<UserEntry[]> {
        return (await this.userStore.select({})).map((u) => {
            delete u._id;
            return u;
        }).filter((u) => {
            if (matrixUsers) {
                return u.type === "matrix";
            }
            return u.type !== "matrix";
        });
    }

    public async getAllUsersForTeam(teamId: string): Promise<UserEntry[]> {
        const users = await this.getAllUsers(false);
        return users.filter((u) => u.team_id === teamId);
    }

    public async getMatrixUser(userId: string): Promise<MatrixUser|null> {
        return (await this.userStore.getMatrixUser(userId)) || null;
    }

    public async storeMatrixUser(user: MatrixUser): Promise<void> {
        return this.userStore.setMatrixUser(user);
    }

    public async upsertRoom(room: BridgedRoom) {
        const entry = room.toEntry();
        return this.roomStore.upsert({id: entry.id}, entry);
    }

    public async deleteRoom(id: string) {
        return this.roomStore.delete({id});
    }

    public async getAllRooms(): Promise<RoomEntry[]> {
        return (await this.roomStore.select({
            matrix_id: {$exists: true},
        })).filter((entry) => {
            delete entry._id;
            // These might be links for legacy-style BridgedRooms, or new-style rooms
            // Only way to tell is via the form of the id
            return entry.id.match(/^INTEG-(.*)$/);
        });
    }

    public async upsertEvent(roomIdOrEntry: string|EventEntry,
                             eventId?: string, channelId?: string, ts?: string, extras?: EventEntryExtra): Promise<void> {
        let storeEv: StoredEvent;
        if (typeof(roomIdOrEntry) === "string") {
            storeEv = new StoredEvent(
                roomIdOrEntry,
                eventId,
                channelId,
                ts,
                extras,
            );
        } else {
            const entry = roomIdOrEntry as EventEntry;
            storeEv = new StoredEvent(
                entry.roomId,
                entry.eventId,
                entry.slackChannelId,
                entry.slackTs,
                entry._extras,
            );
        }
        await this.eventStore.upsertEvent(storeEv);
    }

    private storedEventToEventEntry(storedEvent: StoredEvent): EventEntry {
        return {
            eventId: storedEvent.eventId,
            roomId: storedEvent.roomId,
            slackChannelId: storedEvent.remoteRoomId,
            slackTs: storedEvent.remoteEventId,
            _extras: storedEvent._extras,
        };
    }

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry|null> {
        const storedEvent = await this.eventStore.getEntryByMatrixId(roomId, eventId);
        if (!storedEvent) {
            return null;
        }
        return this.storedEventToEventEntry(storedEvent);
    }

    public async getEventBySlackId(channelId: string, ts: string): Promise<EventEntry|null> {
        const storedEvent = await this.eventStore.getEntryByRemoteId(channelId, ts);
        if (!storedEvent) {
            return null;
        }
        return this.storedEventToEventEntry(storedEvent);
    }

    public async getAllEvents(): Promise<EventEntry[]> {
        return (await this.eventStore.select({})).map((doc) => {
            return {
                eventId: doc.matrix.eventId,
                roomId: doc.matrix.roomId,
                slackChannelId: doc.remote.roomId,
                slackTs: doc.remote.eventId,
                _extras: doc.extras,
            };
        });
    }

    public async upsertTeam(entry: TeamEntry) {
        return this.teamStore.update({id: entry.id}, entry, {upsert: true});
    }

    public async getTeam(teamId: string): Promise<TeamEntry|null> {
        return new Promise((resolve, reject) => {
            // These are technically schemaless
            // tslint:disable-next-line: no-any
            this.teamStore.findOne({id: teamId}, (err: Error|null, doc: any) => {
                if (err || !doc) {
                    resolve(null);
                }
                // We don't use this.
                delete doc._id;
                resolve(doc as TeamEntry);
            });
        });
    }

    public async getAllTeams(): Promise<TeamEntry[]> {
        return new Promise((resolve, reject) => {
            // These are technically schemaless
            // tslint:disable-next-line: no-any
            this.teamStore.find({}, (err: Error|null, docs: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(docs.map((doc) => {
                    // We don't use this.
                    delete doc._id;
                    return doc as TeamEntry;
                }));
            });
        });
    }

    public async setPuppetToken(): Promise<void> {
        // Puppeting not supported by NeDB - noop
        return;
    }

    public async removePuppetTokenByMatrixId() {
        return;
    }

    public async getPuppetTokenBySlackId(): Promise<string|null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(): Promise<string|null> {
        return null;
    }

    public async getPuppetsByMatrixId(): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetedUsers(): Promise<[]> {
        return [];
    }

    public async getPuppetMatrixUserBySlackId(teamId: string, slackId: string): Promise<null> {
        return null;
    }

    public async getUserAdminRoom(): Promise<null> {
        throw Error("Not supported on NeDB");
    }

    public async getUserForAdminRoom(): Promise<null> {
        throw Error("Not supported on NeDB");
    }

    public async setUserAdminRoom(): Promise<void> {
        throw Error("Not supported on NeDB");
    }

    public async getActiveRoomsPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<any> {
        // no-op; activity metrics are not implemented for NeDB
        return;
    }

    public async getActiveUsersPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<any> {
        // no-op; activity metrics are not implemented for NeDB
        return;
    }

    public async upsertActivityMetrics(matrixId: string, room: BridgedRoom, date?: Date): Promise<void> {
        // no-op; activity metrics are not implemented for NeDB
        return;
    }
}
