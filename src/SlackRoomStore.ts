import { BridgedRoom } from "./BridgedRoom";
import { Logging } from "matrix-appservice-bridge";
import QuickLRU = require("quick-lru");
import { UserAdminRoom } from "./rooms/UserAdminRoom";
import { Main } from "./Main";

const log = Logging.get("SlackRoomStore");

export class SlackRoomStore {
    private rooms: Set<BridgedRoom> = new Set();
    private userAdminRooms: QuickLRU<string, UserAdminRoom> = new QuickLRU({ maxSize: 50 });
    // These are used to optimise the time taken to find a room.
    private roomsBySlackChannelId: Map<string, BridgedRoom> = new Map();
    private roomsByMatrixId: Map<string, BridgedRoom> = new Map();
    private roomsByInboundId: Map<string, BridgedRoom> = new Map();

    public get all(): BridgedRoom[] {
        return [...this.rooms];
    }

    public get matrixRoomCount(): number {
        return this.roomsByMatrixId.size;
    }

    public get remoteRoomCount(): number {
        return this.roomsByInboundId.size;
    }

    public upsertRoom(room: BridgedRoom): void {
        log.debug(`upsertRoom ${room.MatrixRoomId}`);
        this.rooms.add(room);

        // Remove if the room already exists in the map.
        [...this.roomsByMatrixId.keys()].forEach((k) => {
            if (this.roomsByMatrixId.get(k) === room) {
                this.roomsByMatrixId.delete(k);
            }
        });

        [...this.roomsByInboundId.keys()].forEach((k) => {
            if (this.roomsByInboundId.get(k) === room) {
                this.roomsByInboundId.delete(k);
            }
        });

        [...this.roomsBySlackChannelId.keys()].forEach((k) => {
            if (this.roomsBySlackChannelId.get(k) === room) {
                this.roomsBySlackChannelId.delete(k);
            }
        });

        this.roomsByMatrixId.set(room.MatrixRoomId, room);
        this.roomsByInboundId.set(room.InboundId, room);

        if (room.SlackChannelId) {
            this.roomsBySlackChannelId.set(room.SlackChannelId, room);
        }
    }

    public removeRoom(room: BridgedRoom): void {
        log.debug(`removeRoom ${room.MatrixRoomId}`);
        this.roomsByMatrixId.delete(room.MatrixRoomId);

        if (room.SlackChannelId) {
            this.roomsBySlackChannelId.delete(room.SlackChannelId);
        }

        if (room.InboundId) {
            this.roomsByInboundId.delete(room.InboundId);
        }

        this.rooms.delete(room);
    }

    public getBySlackChannelId(channelId: string): BridgedRoom|undefined {
        return this.roomsBySlackChannelId.get(channelId);
    }

    public getBySlackTeamId(teamId: string): BridgedRoom[] {
        // This is called sufficently infrequently that we can do a filter.
        return this.all.filter((r) => r.SlackTeamId === teamId);
    }

    public getByMatrixRoomId(roomId: string): BridgedRoom|undefined {
        return this.roomsByMatrixId.get(roomId);
    }

    public getByInboundId(inboundId: string): BridgedRoom|undefined {
        return this.roomsByInboundId.get(inboundId);
    }

    public getOrCreateAdminRoom(roomId: string, userId: string, main: Main): UserAdminRoom {
        let adminRoom = this.userAdminRooms.get(roomId);
        if (adminRoom) {
            return adminRoom;
        }
        adminRoom = new UserAdminRoom(roomId, userId, main);
        return adminRoom;
    }
}
