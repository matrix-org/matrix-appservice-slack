import { MatrixUser } from "matrix-appservice-bridge";
import {
    Datastore,
    EventEntry,
    EventEntryExtra,
    PuppetEntry,
    ReactionEntry,
    RoomEntry,
    RoomType,
    SlackAccount,
    TeamEntry,
    UserEntry,
} from "../../datastore/Models";
import { SlackGhost } from "../../SlackGhost";
import { BridgedRoom } from "../../BridgedRoom";

export class FakeDatastore implements Datastore {
    constructor(public teams: TeamEntry[] = [], public usersInTeam: UserEntry[] = []) {

    }

    async insertAccount(userId: string, slackId: string, teamId: string, accessToken: string): Promise<null> {
        throw new Error("Method not implemented.");
    }

    async getAccountsForMatrixUser(userId: string): Promise<SlackAccount[]> {
        throw new Error("Method not implemented.");
    }

    async getAccountsForTeam(teamId: string): Promise<SlackAccount[]> {
        throw new Error("Method not implemented.");
    }

    async deleteAccount(userId: string, slackId: string): Promise<null> {
        throw new Error("Method not implemented.");
    }

    async deleteTeam(teamId: string): Promise<null> {
        throw new Error("Method not implemented.");
    }

    public async upsertUser(user: SlackGhost): Promise<null> {
        this.usersInTeam.push(user.toEntry());
        return null;
    }

    public async getUser(id: string): Promise<UserEntry | null> {
        return this.usersInTeam.find((i) => i.id === id) || null;
    }

    public async getMatrixUser(userId: string): Promise<any> {
        throw Error("Method not implemented.");
    }

    public async storeMatrixUser(user: MatrixUser): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getAllUsersForTeam(teamId: string): Promise<UserEntry[]> {
        return this.usersInTeam;
    }

    public async upsertRoom(room: BridgedRoom): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteRoom(id: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getAllRooms(): Promise<RoomEntry[]> {
        throw Error("Method not implemented.");
    }

    public async upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra): Promise<null>;

    public async upsertEvent(roomIdOrEntry: EventEntry): Promise<null>;

    public async upsertEvent(roomId: any, eventId?: any, channelId?: any, ts?: any, extras?: any): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry | null> {
        throw Error("Method not implemented.");
    }

    public async getEventBySlackId(channelId: string, ts: string): Promise<EventEntry | null> {
        throw Error("Method not implemented.");
    }

    public async deleteEventByMatrixId(roomId: string, eventId: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async upsertReaction(entry: ReactionEntry): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getReactionByMatrixId(roomId: string, eventId: string): Promise<ReactionEntry | null> {
        throw Error("Method not implemented.");
    }

    public async getReactionBySlackId(channelId: string, messageTs: string, userId: string, reaction: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteReactionByMatrixId(roomId: string, eventId: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteReactionBySlackId(channelId: string, messageTs: string, userId: string, reaction: string): Promise<null> {
        throw Error("Method not implemented.");
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

    public async setPuppetToken(teamId: string, slackUser: string, matrixId: string, token: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getPuppetTokenBySlackId(teamId: string, slackId: string): Promise<string | null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<string | null> {
        return null;
    }

    public async removePuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getPuppetsByMatrixId(userId: string): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetedUsers(): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetMatrixUserBySlackId(teamId: string, slackId: string): Promise<null> {
        return null;
    }

    public async getUserAdminRoom(matrixId: string): Promise<null> {
        return null;
    }

    public async getUserForAdminRoom(): Promise<null> {
        return null;
    }

    public async setUserAdminRoom(matrixuser: string, roomid: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getActiveRoomsPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<Map<string, Map<RoomType, number>>> {
        return new Map();
    }

    public async getActiveUsersPerTeam(activityThreshholdInDays?: number, historyLengthInDays?: number): Promise<Map<string, Map<boolean, number>>> {
        return new Map();
    }

    public async upsertActivityMetrics(user: MatrixUser | SlackGhost, room: BridgedRoom, date?: Date): Promise<null> {
        return null;
    }

    public async getRoomCount() {
        return 0;
    }
}
