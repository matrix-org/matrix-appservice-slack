import { OAuth2 } from "../../OAuth2";
import { SlackRoomStore } from "../../SlackRoomStore";
import { FakeDatastore } from "./fakeDatastore";
import { TeamEntry, UserEntry } from "../../datastore/Models";
import { FakeIntent } from "./fakeIntent";
import { SlackGhost } from "../../SlackGhost";
import { SlackGhostStore } from "../../SlackGhostStore";
import { IConfig } from "../../IConfig";
import { Bridge } from "matrix-appservice-bridge";

const DEFAULT_OPTS = {
    oauth2: false,
};

interface Opts {
    oauth2: boolean;
    teams?: TeamEntry[];
    usersInTeam?: UserEntry[];
}

export class FakeMain {
    public oauth2?: OAuth2;
    public rooms: SlackRoomStore = new SlackRoomStore();
    public datastore: FakeDatastore;
    private ghostStore: SlackGhostStore;
    constructor(opts: Opts = DEFAULT_OPTS) {
        if (opts.oauth2) {
            this.oauth2 = new OAuth2({
                main: this as any,
                client_id: "fakeid",
                client_secret: "fakesecret",
                redirect_prefix: "https://redir_prefix",
                template_file: "",
            });
        }
        this.datastore = new FakeDatastore(opts.teams, opts.usersInTeam);
        this.ghostStore = new SlackGhostStore(this.rooms, this.datastore, {} as unknown as IConfig, null as unknown as Bridge);
        this.ghostStore.getExisting = this.getExistingSlackGhost.bind(this);
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

    public getUrlForMxc(mxcUrl: string) {
        return "fake-" + mxcUrl;
    }

    public incCounter(type: string, data: {side: string}): void {
        this.counters[type] = (this.counters[type] || []);
        this.counters[type].push(data);
    }

    public get botIntent() {
        return new FakeIntent();
    }

    private async getExistingSlackGhost(userId: string) {
        if (userId === "@stranger:localhost") {
            return new SlackGhost(this.datastore, "12345", undefined, "@stranger:localhost", undefined);
        }
        if (userId === "@thing:localhost") {
            return new SlackGhost(this.datastore, "54321", undefined, "@thing:localhost", undefined);
        }
        return null;
    }
}

class FakeClientFactory {
    public async getClientForUser(teamId: string, matrixId: string) {
        return {};
    }
}
