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

import { Datastore, UserEntry, RoomEntry, EventEntry, EventEntryExtra, TeamEntry, PuppetEntry } from "../../datastore/Models";
import { SlackGhost } from "../../SlackGhost";
import { MatrixUser } from "matrix-appservice-bridge";

export class FakeDatastore implements Datastore {
    constructor(public teams: TeamEntry[] = []) {

    }

    public async upsertUser(user: SlackGhost): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async getUser(id: string): Promise<UserEntry | null> {
        throw new Error("Method not implemented.");
    }

    public async getMatrixUser(userId: string): Promise<MatrixUser> {
        throw new Error("Method not implemented.");
    }

    public async storeMatrixUser(user: MatrixUser): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async upsertRoom(room: import("../../BridgedRoom").BridgedRoom): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async deleteRoom(id: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async getAllRooms(): Promise<RoomEntry[]> {
        throw new Error("Method not implemented.");
    }

    public async upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra | undefined): Promise<void>;

    public async upsertEvent(roomIdOrEntry: EventEntry): Promise<void>;

    public async upsertEvent(roomId: any, eventId?: any, channelId?: any, ts?: any, extras?: any) {
        throw new Error("Method not implemented.");
    }

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry | null> {
        throw new Error("Method not implemented.");
    }

    public async getEventBySlackId(channelId: string, ts: string): Promise<EventEntry | null> {
        throw new Error("Method not implemented.");
    }

    public async upsertTeam(entry: TeamEntry) {
        const idx = this.teams.findIndex((t) => t.id);
        if (idx === -1) {
            this.teams.push(entry);
        } else {
            this.teams[idx] = entry;
        }
    }

    public async getTeam(teamId: string): Promise<TeamEntry | null> {
        return this.teams.find((t) => t.id) || null;
    }

    public async getAllTeams(): Promise<TeamEntry[]> {
        return this.teams;
    }

    public async setPuppetToken(teamId: string, slackUser: string, matrixId: string, token: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async getPuppetTokenBySlackId(teamId: string, slackId: string): Promise<string | null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<string | null> {
        return null;
    }

    public async removePuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async getPuppetsByMatrixId(userId: string): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetedUsers(): Promise<PuppetEntry[]> {
        throw new Error("Method not implemented.");
    }

}
