import { Datastore, UserEntry, RoomEntry, EventEntry, EventEntryExtra, TeamEntry, PuppetEntry } from "../../datastore/Models";
import { SlackGhost } from "../../SlackGhost";
import { MatrixUser } from "matrix-appservice-bridge";
import { BridgedRoom } from "../../BridgedRoom";

export class FakeDatastore implements Datastore {
    constructor(public teams: TeamEntry[] = [], public usersInTeam: UserEntry[] = []) {

    }

    public async upsertUser(user: SlackGhost): Promise<void> {
        this.usersInTeam.push(user.toEntry());
    }

    public async getUser(id: string): Promise<UserEntry | null> {
        return this.usersInTeam.find((i) => i.id === id) || null;
    }

    public async getMatrixUser(userId: string): Promise<any> {
        throw Error("Method not implemented.");
    }

    public async storeMatrixUser(user: MatrixUser): Promise<void> {
        throw Error("Method not implemented.");
    }

    public async getAllUsersForTeam(teamId: string): Promise<UserEntry[]> {
        return this.usersInTeam;
    }

    public async upsertRoom(room: BridgedRoom): Promise<void> {
        throw Error("Method not implemented.");
    }

    public async deleteRoom(id: string): Promise<void> {
        throw Error("Method not implemented.");
    }

    public async getAllRooms(): Promise<RoomEntry[]> {
        throw Error("Method not implemented.");
    }

    public async upsertEvent(roomId: string, eventId: string, channelId: string, ts: string, extras?: EventEntryExtra | undefined): Promise<void>;

    public async upsertEvent(roomIdOrEntry: EventEntry): Promise<void>;

    public async upsertEvent(roomId: any, eventId?: any, channelId?: any, ts?: any, extras?: any) {
        throw Error("Method not implemented.");
    }

    public async getEventByMatrixId(roomId: string, eventId: string): Promise<EventEntry | null> {
        throw Error("Method not implemented.");
    }

    public async getEventBySlackId(channelId: string, ts: string): Promise<EventEntry | null> {
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

    public async setPuppetToken(teamId: string, slackUser: string, matrixId: string, token: string): Promise<void> {
        throw Error("Method not implemented.");
    }

    public async getPuppetTokenBySlackId(teamId: string, slackId: string): Promise<string | null> {
        return null;
    }

    public async getPuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<string | null> {
        return null;
    }

    public async removePuppetTokenByMatrixId(teamId: string, matrixId: string): Promise<void> {
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

    public async setUserAdminRoom(matrixuser: string, roomid: string): Promise<void> {
        throw Error("Method not implemented.");
    }
}
