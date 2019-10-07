import { OAuth2 } from "../../OAuth2";
import { SlackRoomStore } from "../../SlackRoomStore";
import { FakeDatastore } from "./fakeDatastore";
import { TeamEntry } from "../../datastore/Models";

const DEFAULT_OPTS = {
    oauth2: false,
};

interface Opts {
    oauth2: boolean;
    teams?: TeamEntry[];
}

export class FakeMain {
    public oauth2?: OAuth2;
    public rooms: SlackRoomStore;
    public datastore: FakeDatastore;
    constructor(opts: Opts = DEFAULT_OPTS) {
        if (opts.oauth2) {
            this.oauth2 = new OAuth2({
                // tslint:disable-next-line: no-any
                main: this as any,
                client_id: "fakeid",
                client_secret: "fakesecret",
                redirect_prefix: "redir_prefix",
            });
        }
        this.datastore = new FakeDatastore(opts.teams);
        this.rooms = new SlackRoomStore(this.datastore, null);
    }
    public readonly timerFinished: {[eventName: string]: string } = {};
    public readonly counters: {[type: string]: [{side: string}] } = {};

    public clientFactory: FakeClientFactory = new FakeClientFactory();

    public startTimer(eventName: string) {
        this.timerFinished[eventName] = "notfinished";
        return (reason: {outcome: string}) => {
            this.timerFinished[eventName] = reason.outcome;
        };
    }

    public incCounter(type: string, data: {side: string}): void {
        this.counters[type] = (this.counters[type] || []);
        this.counters[type].push(data);
    }
}

class FakeClientFactory {
    public async getClientForUser(teamId: string, matrixId: string) {
        return {};
    }
}
