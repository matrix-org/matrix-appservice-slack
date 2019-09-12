/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { WebClientOptions } from "@slack/web-api";
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
