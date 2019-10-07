import { BridgedRoom } from "./BridgedRoom";
import { Logging } from "matrix-appservice-bridge";
import { Datastore } from "./datastore/Models";
import QuickLRU = require("quick-lru");
import { IConfig } from "./IConfig";

const log = Logging.get("SlackRoomStore");

export class SlackRoomStore {
    private rooms: Set<BridgedRoom> = new Set();
    // These are used to optimise the time taken to find a room.
    private roomsBySlackChannelId: QuickLRU<string, BridgedRoom>;
    private roomsByMatrixId: QuickLRU<string, BridgedRoom>;
    private roomsByInboundId: QuickLRU<string, BridgedRoom>;

    constructor(private store: Datastore, private cacheSize: number) {
        this.roomsBySlackChannelId = new QuickLRU({ maxSize: cacheSize });
        this.roomsByMatrixId = new QuickLRU({ maxSize: cacheSize });
        this.roomsByInboundId = new QuickLRU({ maxSize: cacheSize });
    }

    public get all() {
        return [...this.rooms];
    }

    public get matrixRoomCount() {
        return this.store.getRoomCount("matrix");
    }

    public get remoteRoomCount() {
        return this.store.getRoomCount("remote");
    }

    public upsertRoom(room: BridgedRoom) {
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

    public removeRoom(room: BridgedRoom) {
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
        const res = this.roomsBySlackChannelId.get(channelId);
        if (!res) {
            return res;
        }
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
}
