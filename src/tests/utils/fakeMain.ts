export class FakeMain {
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

