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
import { MatrixUser, UserActivity, UserActivitySet } from "matrix-appservice-bridge";
import { MatrixUser as BridgeMatrixUser } from "../MatrixUser";

export interface RoomEntry {
    id: string;
    matrix_id: string;
    remote_id: string;
    remote: {
        slack_team_id?: string;
        slack_type?: string;
        id: string;
        name: string;
        webhook_uri?: string;
        slack_private?: boolean;
        puppet_owner?: string;
    };
}

export interface UserEntry {
    id: string;
    display_name?: string;
    avatar_url?: string;
    slack_id: string;
    team_id?: string;
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

export interface ReactionEntry {
    eventId: string;
    roomId: string;
    slackChannelId: string;
    slackMessageTs: string;
    slackUserId: string;
    reaction: string;
}

export type TeamStatus = "ok"|"archived"|"bad_auth";

export interface TeamEntry {
    id: string;
    bot_token: string;
    name: string;
    bot_id: string;
    domain: string;
    scopes: string;
    status: TeamStatus;
    user_id: string;
}

export interface PuppetEntry {
    matrixId: string;
    teamId: string;
    slackId: string;
    token: string;
}

export interface SlackAccount {
    matrixId: string;
    teamId: string;
    slackId: string;
    accessToken: string;
}

export type RoomType = "user" | "channel";

export interface Datastore {
    // Users
    upsertUser(user: SlackGhost): Promise<null>;
    getUser(id: string): Promise<UserEntry|null>;
    getMatrixUser(userId: string): Promise<MatrixUser|null>;
    storeMatrixUser(user: MatrixUser): Promise<null>;
    getAllUsersForTeam(teamId: string): Promise<UserEntry[]>;

    insertAccount(userId: string, slackId: string, teamId: string, accessToken: string): Promise<null>;
    getAccountsForMatrixUser(userId: string): Promise<SlackAccount[]>;
    getAccountsForTeam(teamId: string): Promise<SlackAccount[]>;
    deleteAccount(userId: string, slackId: string): Promise<null>;

    // Rooms
    upsertRoom(room: BridgedRoom): Promise<null>;
    deleteRoom(id: string): Promise<null>;
    getAllRooms(): Promise<RoomEntry[]>;

    // Custom emoji
    upsertCustomEmoji(teamId: string, name: string, mxc: string): Promise<null>;
    getCustomEmojiMxc(teamId: string, name: string): Promise<string|null>;
    deleteCustomEmoji(teamId: string, name: string): Promise<null>;

    // Events
    upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra): Promise<null>;
    upsertEvent(roomIdOrEntry: EventEntry): Promise<null>;
    getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry|null>;
    getEventBySlackId(channelId: string, ts: string): Promise<EventEntry|null>;
    deleteEventByMatrixId(roomId: string, eventId: string): Promise<null>;

    // Reactions
    upsertReaction(entry: ReactionEntry): Promise<null>;
    getReactionByMatrixId(roomId: string, eventId: string): Promise<ReactionEntry|null>;
    getReactionBySlackId(channelId: string, messageTs: string, userId: string, reaction: string): Promise<ReactionEntry|null>;
    deleteReactionByMatrixId(roomId: string, eventId: string): Promise<null>;
    deleteReactionBySlackId(channelId: string, messageTs: string, userId: string, reaction: string): Promise<null>;

    // Teams
    upsertTeam(entry: TeamEntry);
    getTeam(teamId: string): Promise<TeamEntry|null>;
    getAllTeams(): Promise<TeamEntry[]>;
    deleteTeam(teamId: string): Promise<null>;

    // Puppets
    setPuppetToken(teamId: string, slackUser: string, matrixId: string, token: string): Promise<null>;
    getPuppetTokenBySlackId(teamId: string, slackId: string): Promise<string|null>;
    getPuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<string|null>;
    getPuppetMatrixUserBySlackId(teamId: string, slackId: string): Promise<string|null>;
    removePuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<null>;
    getPuppetsByMatrixId(userId: string): Promise<PuppetEntry[]>;
    getPuppetedUsers(): Promise<PuppetEntry[]>;

    // Admin rooms
    getUserAdminRoom(matrixId: string): Promise<string|null>;
    getUserForAdminRoom(roomId: string): Promise<string|null>;
    setUserAdminRoom(matrixuser: string, roomId: string): Promise<null>;

    // User activity
    storeUserActivity(matrixId: string, activity: UserActivity): Promise<void>;
    getUserActivity(): Promise<UserActivitySet>;

    // Metrics
    /**
     * Returns active rooms grouped by their team.
     * @param activityThreshholdInDays How many days of activity make a room count as active?
     * @param historyLengthInDays How many days of history shall be taken into account?
     */
    getActiveRoomsPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<Map<string, Map<RoomType, number>>>;
    /**
     * Returns active users grouped by their team.
     * @param activityThreshholdInDays How many days of activity make a user count as active?
     * @param historyLengthInDays How many days of history shall be taken into account?
     */
    getActiveUsersPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<Map<string, Map<boolean, number>>>;
    /**
     * Records an activity taken by a user inside a room on a specific date.
     * This will be used for the metrics of active users and rooms.
     * @param user The user who took an action
     * @param room The room an action was taken in
     * @param date The date of the action (defaults to the current date)
     */
    upsertActivityMetrics(user: BridgeMatrixUser | SlackGhost, room: BridgedRoom, date?: Date): Promise<null>;

    /**
     * Get the number of connected rooms on this instance.
     */
    getRoomCount(): Promise<number>;
}
