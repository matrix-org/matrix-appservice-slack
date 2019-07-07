import { Logging, Bridge } from "matrix-appservice-bridge";
import { Main } from "./Main";

import { Request, Response} from "express";

const log = Logging.get("Provisioning");

type CommandFunc = (main: Main, req: Request, res: Response, ...params: string[]) => void|Promise<void>;
export const commands: {[verb: string]: Command} = {};

const HTTP_CLIENT_ERROR = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

type Param = string;

export class Command {
    private params: Param[];
    private func: CommandFunc;
    constructor(opts: {params: Param[], func: CommandFunc}) {
        this.params = opts.params;
        this.func = opts.func;
    }

    public async run(main: Main, req: Request, res: Response) {
        const body = req.body;
        const args: [Main, Request, Response, ...string[]] = [main, req, res];
        for (const param of this.params) {
            if (!(param in body)) {
                res.status(HTTP_CLIENT_ERROR).json({error: `Required parameter ${param} missing`});
                return;
            }

            args.push(body[param]);
        }

        try {
            await this.func.apply(this, args);
        } catch (err) {
            log.error("Provisioning command threw an error:", err);
            res.status(err.code || HTTP_SERVER_ERROR).json({error: err.text || err.message || err});
        }
    }
}

export async function handle(main: Main, verb: string, req: Request, res: Response) {
    const prov = commands[verb];

    if (!prov) {
        res.status(HTTP_NOT_FOUND).json({error: "Unrecognised provisioning command " + verb});
        return;
    }
    try {
        await prov.run(main, req, res);
    } catch (e) {
        log.error("Provisioning command failed:", e);
        res.status(HTTP_SERVER_ERROR).json({error: "Provisioning command failed " + e});
    }
}

export function addAppServicePath(bridge: Bridge, main: Main) {
    bridge.addAppServicePath({
        handler: async (req: Request, res: Response) => {
            const verb = req.params.verb;
            log.info("Received a _matrix/provision request for " + verb);
            await handle(main, verb, req, res);
        },
        method: "POST",
        path: "/_matrix/provision/:verb",
    });
}
