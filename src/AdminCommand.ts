import { Options, Argv, default as yargs } from "yargs";

export type ResponseCallback = (response: string) => void;
interface IHandlerArgs {
    matched: (b: true) =>  void,
    completed: (err: Error|null) =>  void,
    respond: ResponseCallback;
    [key: string]: unknown;
}
type CommandCallback = (args: IHandlerArgs) => void;

export class AdminCommand {
    constructor(
        public readonly command: string | string[],
        public readonly description: string,
        private readonly cb: CommandCallback,
        public readonly options: {[key: string]: Options} = {}) {

    }

    public async handler(argv: IHandlerArgs) {
        // This might be promisey
        argv.matched(true);
        try {
            await this.cb(argv);
            argv.completed(null);
        } catch (ex) {
            argv.completed(ex);
        }
    }
}
