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
import { MatrixUser } from "matrix-appservice-bridge";

export interface RoomEntry {
    id: string;
    matrix_id: string;
    remote_id: string;
    remote: {
        slack_team_id?: string;
        slack_bot_token?: string;
        access_scopes: string[];
        access_token: string;
        slack_bot_id: string;
        id: string;
        name: string;
        slack_team_domain: string;
        slack_user_id: string;
        slack_user_token: string;
        webhook_uri: string;
    };
}

export interface UserEntry {
    id: string;
    matrix_id: string;
    display_name: string;
    get: (key: string) => string;
    set: (key: string, value: string) => void;
}

export interface EventEntry {
    eventId: string;
    roomId: string;
    slackChannelId: string;
    slackTs: string;
    _extras: EventEntryExtra;
}

export interface EventEntryExtra {
    slackThreadMessages?: string[];
}

export interface TeamEntry {
    team_id: string;
    bot_token: string;
    team_name: string;
    user_id: string;
}

export interface Datastore {
    upsertUser(user: SlackGhost): Promise<void>;
    getUser(id: string): Promise<UserEntry|null>;
    getMatrixUser(userId: string): Promise<MatrixUser|null>;
    storeMatrixUser(user: MatrixUser): Promise<void>;

    upsertRoom(room: BridgedRoom): Promise<void>;
    deleteRoom(id: string): Promise<void>;
    getAllRooms(): Promise<RoomEntry[]>;

    upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra): Promise<void>;
    upsertEvent(roomIdOrEntry: EventEntry): Promise<void>;
    getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry|null>;
    getEventBySlackId(channelId: string, ts: string): Promise<EventEntry|null>;

    upsertTeam(teamId: string, botToken: string, teamName: string, botId: string);
    getTeam(teamId: string): Promise<TeamEntry>;
}
