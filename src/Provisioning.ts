import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("Provisioning");

type CommandFunc = (...params: any[]) => Promise<void>;
export const commands: {[verb: string]: Command} = {};

export class Command {
    private params: any[];
    private func: CommandFunc;
    constructor (opts: {params: any[], func: CommandFunc}) {
        this.params = opts.params;
        this.func = opts.func;
    }

    public async run(service: any, req: any, res: any) {
        const body = req.body;
        const args = [service, req, res];
        for (const param of this.params) {
            if(!(param in body)) {
                res.status(400).json({error: "Required parameter " + param + " missing"});
                return;
            }
    
            args.push(body[param]);
        }

        try {
            await this.func.apply(this, args);
        } catch (err) {
            log.error("Provisioning command threw an error:", err);
            res.status(err.code || 500).json({error: err.text || err.message || err});
        }
    }
}

export async function handle(service: any, verb: string, req: any, res: any) {
    const prov = commands[verb];

    if (!prov) {
        res.status(404).json({error: "Unrecognised provisioning command " + verb});
        return;
    }
    try {
        await prov.run(service, req, res);
    } catch (e) {
        log.error("Provisioning command failed:", e);
        res.status(500).json({error: "Provisioning command failed " + e});
    }
};

export function addAppServicePath(bridge: any, service: any) {
    bridge.addAppServicePath({
        method: "POST",
        path: "/_matrix/provision/:verb",
        handler: (req: any, res: any) => {
            var verb = req.params.verb;
            log.info("Received a _matrix/provision request for " + verb);
            handle(service, verb, req, res);
        }
    });
}