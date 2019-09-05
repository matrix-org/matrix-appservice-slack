import { BridgedRoom } from "../../BridgedRoom";
import { Main } from "../../Main";

interface RoomInfo {
    topic?: string;
}

export class FakeMain {
    public readonly timerFinished: {[eventName: string]: string } = {};
    public readonly counters: {[counter: string]: number} = {};
    public readonly roomInfo: {[roomId: string]: RoomInfo} = {};
    constructor(private validChannelIds: string[]|true = true) {

    }

    public get botIntent() {
        return {
            setRoomTopic: (roomId, topic) => {
                const existing = this.roomInfo[roomId];
                this.roomInfo[roomId] = { ...existing, topic };
            },
        };
    }

    public startTimer(eventName: string) {
        this.timerFinished[eventName] = "notfinished";
        return (reason: {outcome: string}) => {
            this.timerFinished[eventName] = reason.outcome;
        };
    }

    public getRoomBySlackChannelId(channelId: string): BridgedRoom|undefined {
        if (this.validChannelIds === true || this.validChannelIds.includes(channelId)) {
            return new BridgedRoom(this as unknown as Main, {
                matrix_room_id: "!somefake:room",
                inbound_id: "someid",
            } as any);
        }
    }

    public incCounter(counter: string, extra: {remote: string}) {
        this.counters[counter] = (this.counters[counter] || 0) + 1;
    }
}
