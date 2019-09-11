import { WebClientOptions, LogLevel } from "@slack/web-api";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import { promisify } from "util";
import { TeamInfoResponse } from "../../SlackResponses";

export class SlackTestApi {
    private server: Server;
    public readonly allowAuthFor: Set<string> = new Set();
    constructor() {
        this.server = createServer(this.onRequest.bind(this));
    }

    public get opts(): WebClientOptions {
        return {
            slackApiUrl: "http://localhost:56999",
            retryConfig: {
                retries: 0,
            },
        };
    }

    public async start() {
        return new Promise((resolve: () => void, reject: (err: Error) => void) => {
            const srv = createServer(this.onRequest.bind(this));
            srv.once("error", reject);
            srv.listen(56999, () => {
                srv.removeAllListeners("error");
                resolve();
            });
            this.server = srv;
        });
    }

    public async close() {
        if (this.server) {
            return promisify(this.server.close).bind(this.server)();
        }
    }

    private onRequest(req: IncomingMessage, res: ServerResponse) {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
            if (req.method === "POST" && req.url === "/team.info") {
                this.onTeamInfo(req, body, res);
            } else {
                res.writeHead(404);
                res.write("Nada");
            }
            res.end();
        });
    }

    private onTeamInfo(req: IncomingMessage, body: string, res: ServerResponse) {
        const token = body.substr("token=".length);
        // Slack usually uses 200s for everything.
        res.writeHead(200, "OK", {"Content-Type": "application/json"});
        if (this.allowAuthFor.has(token)) {
            res.write(JSON.stringify({
                ok: false,
                team: {
                    id: "foo",
                    domain: "foobar",
                },
            } as TeamInfoResponse));
        } else {
            res.write(JSON.stringify({
                ok: false,
                error: "Team not allowed for test",
            }));
        }
    }
}
