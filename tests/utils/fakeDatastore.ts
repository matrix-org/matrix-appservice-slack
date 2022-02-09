import { UserActivity, UserActivitySet } from "matrix-appservice-bridge";
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
} from "../../src/datastore/Models";
import { SlackGhost } from "../../src/SlackGhost";

export class FakeDatastore implements Datastore {
    constructor(public teams: TeamEntry[] = [], public usersInTeam: UserEntry[] = []) {

    }

    async insertAccount(): Promise<null> {
        throw new Error("Method not implemented.");
    }

    async getAccountsForMatrixUser(): Promise<SlackAccount[]> {
        throw new Error("Method not implemented.");
    }

    async getAccountsForTeam(): Promise<SlackAccount[]> {
        throw new Error("Method not implemented.");
    }

    async deleteAccount(): Promise<null> {
        throw new Error("Method not implemented.");
    }

    async deleteTeam(): Promise<null> {
        throw new Error("Method not implemented.");
    }

    public async upsertUser(user: SlackGhost): Promise<null> {
        this.usersInTeam.push(user.toEntry());
        return null;
    }

    public async getUser(id: string): Promise<UserEntry | null> {
        return this.usersInTeam.find((i) => i.id === id) || null;
    }

    public async getMatrixUser(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async storeMatrixUser(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getAllUsersForTeam(): Promise<UserEntry[]> {
        return this.usersInTeam;
    }

    public async upsertRoom(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteRoom(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getAllRooms(): Promise<RoomEntry[]> {
        throw Error("Method not implemented.");
    }

    public async upsertCustomEmoji(teamId: string, name: string, mxc: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getCustomEmojiMxc(teamId: string, name: string): Promise<string | null> {
        throw Error("Method not implemented.");
    }

    public async deleteCustomEmoji(teamId: string, name: string): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra): Promise<null>;

    public async upsertEvent(roomIdOrEntry: EventEntry): Promise<null>;

    public async upsertEvent(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getEventByMatrixId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getEventBySlackId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteEventByMatrixId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async upsertReaction(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getReactionByMatrixId(): Promise<ReactionEntry | null> {
        throw Error("Method not implemented.");
    }

    public async getReactionBySlackId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteReactionByMatrixId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async deleteReactionBySlackId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async upsertTeam(entry: TeamEntry): Promise<void> {
        const idx = this.teams.findIndex((t) => t.id);
        if (idx === -1) {
            this.teams.push(entry);
        } else {
            this.teams[idx] = entry;
        }
    }

    public async getTeam(teamId: string): Promise<TeamEntry | null> {
        return this.teams.find((t) => t.id === teamId) || null;
    }

    public async getAllTeams(): Promise<TeamEntry[]> {
        return this.teams;
    }

    public async setPuppetToken(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getPuppetTokenBySlackId(): Promise<null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(): Promise<null> {
        return null;
    }

    public async removePuppetTokenByMatrixId(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getPuppetsByMatrixId(): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetedUsers(): Promise<PuppetEntry[]> {
        return [];
    }

    public async getPuppetMatrixUserBySlackId(): Promise<null> {
        return null;
    }

    public async getUserAdminRoom(): Promise<null> {
        return null;
    }

    public async getUserForAdminRoom(): Promise<null> {
        return null;
    }

    public async setUserAdminRoom(): Promise<null> {
        throw Error("Method not implemented.");
    }

    public async getActiveRoomsPerTeam(): Promise<Map<string, Map<RoomType, number>>> {
        return new Map();
    }

    public async getActiveUsersPerTeam(): Promise<Map<string, Map<boolean, number>>> {
        return new Map();
    }

    public async upsertActivityMetrics(): Promise<null> {
        return null;
    }

    public async getRoomCount(): Promise<number> {
        return 0;
    }

    public async storeUserActivity(matrixId: string, activity: UserActivity) {
    }

    public async getUserActivity(): Promise<UserActivitySet> {
        return { users: {} };
    }

}
