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
import { Datastore, UserEntry, RoomEntry, TeamEntry, EventEntry, EventEntryExtra } from "./Models";
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

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry|null> {
        const storedEvent = await this.eventStore.getEntryByMatrixId(roomId, eventId);
        if (!storedEvent) {
            return null;
        }
        return {
            eventId: storedEvent.eventId,
            roomId: storedEvent.roomId,
            slackChannelId: storedEvent.remoteRoomId,
            slackTs: storedEvent.remoteEventId,
            _extras: storedEvent._extras,
        };
    }

    public async getEventBySlackId(channelId: string, ts: string): Promise<EventEntry|null> {
        const storedEvent = await this.eventStore.getEntryByRemoteId(channelId, ts);
        if (!storedEvent) {
            return null;
        }
        return {
            eventId: storedEvent.eventId,
            roomId: storedEvent.roomId,
            slackChannelId: storedEvent.remoteRoomId,
            slackTs: storedEvent.remoteEventId,
            _extras: storedEvent._extras,
        };
    }

    public async upsertTeam(teamId: string, botToken: string, teamName: string, userId: string) {
        return this.teamStore.update({team_id: teamId}, {
            bot_token: botToken,
            team_id: teamId,
            team_name: teamName,
            user_id: userId,
        } as TeamEntry, {upsert: true});
    }

    public async getTeam(teamId: string): Promise<TeamEntry> {
        return new Promise((resolve, reject) => {
            // These are technically schemaless
            // tslint:disable-next-line: no-any
            this.teamStore.findOne({team_id: teamId}, (err: Error|null, doc: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                // We don't use this.
                delete doc._id;
                resolve(doc as TeamEntry);
            });
        });
    }

    public async setPuppetToken(): Promise<void> {
        // Puppeting not supported by NeDB yet - noop
        return;
    }

    public async getPuppetTokenBySlackId(): Promise<string|null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(): Promise<string|null> {
        return null;
    }

    public async getPuppetedUsers(): Promise<[]> {
        return [];
    }
}
