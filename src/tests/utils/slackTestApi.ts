import { WebClientOptions, LogLevel } from "@slack/web-api";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import { promisify } from "util";
import { TeamInfoResponse, AuthTestResponse, UsersInfoResponse } from "../../SlackResponses";
import * as qs from "querystring";

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
            const query = qs.decode(body);
            if (req.method === "POST" && req.url === "/team.info") {
                this.onTeamInfo(query, res);
            } else if (req.method === "POST" && req.url === "/auth.test") {
                this.onAuthTest(query, res);
            } else if (req.method === "POST" && req.url === "/users.info") {
                this.onUsersInfo(query, res);
            } else {
                res.writeHead(404);
                res.write("Nada");
            }
            res.end();
        });
    }

    private onAuthTest(query: qs.ParsedUrlQuery, res: ServerResponse) {
        // Slack usually uses 200s for everything.
        res.writeHead(200, "OK", {"Content-Type": "application/json"});
        if (this.allowAuthFor.has(query.token as string)) {
            res.write(JSON.stringify({
                ok: true,
                url: "https://subarachnoid.slack.com/",
                team: "Subarachnoid Workspace",
                user: "bot",
                team_id: "T0G9PQBBK",
                user_id: "W23456789",
            } as AuthTestResponse));
        } else {
            res.write(JSON.stringify({
                ok: false,
                error: "invalid_auth",
            }));
        }
    }

    private onTeamInfo(query: qs.ParsedUrlQuery, res: ServerResponse) {
        // Slack usually uses 200s for everything.
        res.writeHead(200, "OK", {"Content-Type": "application/json"});
        if (this.allowAuthFor.has(query.token as string)) {
            res.write(JSON.stringify({
                ok: true,
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

    private onUsersInfo(query: qs.ParsedUrlQuery, res: ServerResponse) {
        // Slack usually uses 200s for everything.
        res.writeHead(200, "OK", {"Content-Type": "application/json"});
        if (this.allowAuthFor.has(query.token as string)) {
            res.write(JSON.stringify({
                ok: true,
                user: {
                    id: "W012A3CDE",
                    team_id: "T012AB3C4",
                    name: "alice",
                    deleted: false,
                    real_name: "Alice",
                    is_bot: true,
                    profile: {
                        bot_id: "12345",
                    },
                },
            } as UsersInfoResponse));
        } else {
            res.write(JSON.stringify({
                ok: false,
                error: "Team not allowed for test",
            }));
        }
    }
}
