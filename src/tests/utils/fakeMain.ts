import { OAuth2 } from "../../OAuth2";

const DEFAULT_OPTS = {
    oauth2: false,
};

interface Opts {
    oauth2: boolean;
}

export class FakeMain {
    protected oauth2?: OAuth2;
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
    }
    public readonly timerFinished: {[eventName: string]: string } = {};

    public clientFactory: FakeClientFactory = new FakeClientFactory();

    public startTimer(eventName: string) {
        this.timerFinished[eventName] = "notfinished";
        return (reason: {outcome: string}) => {
            this.timerFinished[eventName] = reason.outcome;
        };
    }
}

class FakeClientFactory {
    public async getClientForUser(teamId: string, matrixId: string) {
        return {};
    }
}
