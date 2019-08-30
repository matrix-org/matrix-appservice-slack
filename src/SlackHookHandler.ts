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

import * as fs from "fs";
import { createServer as httpCreate, RequestListener,
    Server, IncomingMessage, ServerResponse } from "http";
import { createServer as httpsCreate } from "https";
import * as qs from "querystring";
import { Logging } from "matrix-appservice-bridge";
import { SlackEventHandler } from "./SlackEventHandler";
import { BaseSlackHandler, HTTP_CODES, ISlackMessageEvent } from "./BaseSlackHandler";
import { BridgedRoom } from "./BridgedRoom";
import { Main } from "./Main";
import { WebClient } from "@slack/web-api";
import { ConversationsHistoryResponse } from "./SlackResponses";

const log = Logging.get("SlackHookHandler");

const PRESERVE_KEYS = [
    "team_domain", "team_id",
    "channel_name", "channel_id",
    "user_name", "user_id",
];

export interface ISlackEventPayload {
    // https://api.slack.com/types/event
    token: string;
    team_id: string;
    api_app_id: string;
    event?: unknown;
    type: "event_callback"|"url_verification";
    event_id: string;
    event_time: string;
    authed_users: string;
    // https://api.slack.com/events/url_verification
    challenge?: string;
}

export class SlackHookHandler extends BaseSlackHandler {
    public readonly eventHandler: SlackEventHandler;
    constructor(main: Main) {
        super(main);
        this.eventHandler = new SlackEventHandler(main);
    }

    public async startAndListen(port: number, tlsConfig: {key_file: string, crt_file: string}) {
        let createServer: (cb?: RequestListener) => Server = httpCreate;
        if (tlsConfig) {
            const tlsOptions = {
                cert: fs.readFileSync(tlsConfig.crt_file),
                key: fs.readFileSync(tlsConfig.key_file),
            };
            createServer = (cb) => httpsCreate(tlsOptions, cb);
        }
        return new Promise((resolve: () => void, reject: (err: Error) => void) => {
            const srv = createServer(this.onRequest.bind(this));
            srv.once("error", reject);
            srv.listen(port, () => {
                const protocol = tlsConfig ? "https" : "http";
                log.info(`Slack-side listening on port ${port} over ${protocol}`);
                srv.removeAllListeners("error");
                resolve();
            });
        });
    }

    private onRequest(req: IncomingMessage, res: ServerResponse) {
        const HTTP_SERVER_ERROR = 500;
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
            log.debug(`${req.method} ${req.url} bodyLen=${body.length}`);
            // if isEvent === true, this was an event emitted from the slack Event API
            // https://api.slack.com/events-api
            const isEvent = req.headers["content-type"] === "application/json" && req.method === "POST";
            try {
                if (isEvent) {
                    const eventsResponse = (resStatus, resBody, resHeaders) => {
                        if (resHeaders) {
                            res.writeHead(resStatus, resHeaders);
                        } else {
                            res.writeHead(resStatus);
                        }
                        if (resBody) {
                            res.write(resBody);
                        }
                        res.end();
                    };
                    const eventPayload = JSON.parse(body) as ISlackEventPayload;
                    if (eventPayload.type === "url_verification") {
                        this.eventHandler.onVerifyUrl(eventPayload.challenge!, eventsResponse);
                    } else if (eventPayload.type === "event_callback") {
                        this.eventHandler.handle(
                            // The event can take many forms.
                            // tslint:disable-next-line: no-any
                            eventPayload.event as any,
                            eventPayload.team_id,
                            eventsResponse,
                        ).catch((ex) => {
                            log.error("Failed to handle event", ex);
                        });
                    }
                } else {
                    const params = qs.parse(body);
                    this.handle(req.method!, req.url!, params, res).catch((ex) => {
                        log.error("Failed to handle webhook event", ex);
                    });
                }
            } catch (e) {
                log.error("SlackHookHandler failed:", e);
                res.writeHead(HTTP_SERVER_ERROR, {"Content-Type": "text/plain"});
                if (req.method !== "HEAD") {
                    res.write("Internal Server Error");
                }
                res.end();
            }
        });
    }

    /**
     * Handles a slack webhook request.
     *
     * Sends a message to Matrix if it understands enough of the message to do so.
     * Attempts to make the message as native-matrix feeling as it can.
     * @param method The HTTP method for the incoming request
     * @param url The HTTP url for the incoming request
     * @param params Parameters given in either the body or query string.
     */
    private async handle(method: string, url: string, params: {[key: string]: string|string[]},
                         response: ServerResponse) {
        log.info(`Received slack webhook ${method} ${url}: ${JSON.stringify(params)}`);
        const endTimer = this.main.startTimer("remote_request_seconds");
        const urlMatch = url.match(/^\/(.{32})(?:\/(.*))?$/);

        if (!urlMatch) {
            log.error("Ignoring message with bad slackhook URL " + url);

            response.writeHead(HTTP_CODES.NOT_FOUND, {"Content-Type": "text/plain"});
            response.end();

            endTimer({outcome: "dropped"});
            return;
        }

        const inboundId = urlMatch[1];
        let path = urlMatch[2] || "post";

        // GET requests (e.g. authorize) have params in query string
        if (method === "GET") {
            const result = path.match(/^([^?]+)(?:\?(.*))$/);
            path = result![1];
            params = qs.parse(result![2]);
        }

        const room = this.main.getRoomByInboundId(inboundId);

        if (method === "GET" && path === "authorize") {
            // We may or may not have a room bound to the inboundId.
            const result = await this.handleAuthorize(room || inboundId, params);
            response.writeHead(result.code || HTTP_CODES.OK, {"Content-Type": "text/html"});
            response.write(result.html);
            response.end();
            endTimer({outcome: "success"});
            return;
        }

        if (!room) {
            log.warn("Ignoring message from unrecognised inbound ID: %s (%s.#%s)",
                inboundId, params.team_domain, params.channel_name,
            );
            this.main.incCounter("received_messages", {side: "remote"});

            response.writeHead(HTTP_CODES.OK, {"Content-Type": "text/plain"});
            response.end();

            endTimer({outcome: "dropped"});
            return;
        }

        if (method === "POST" && path === "post") {
            try {
                if (!room) {
                    throw new Error("No room found for inboundId");
                }
                await this.handlePost(room, params);
                endTimer({outcome: "success"});
            } catch (ex) {
                endTimer({outcome: "fail"});
                log.error("handlePost failed: ", ex);
            }
            response.writeHead(HTTP_CODES.OK, {"Content-Type": "application/json"});
            response.end();
            return;
        }

        log.debug(`Got call to ${method}${path} that we can't handle`);
        response.writeHead(HTTP_CODES.OK, {"Content-Type": "application/json"});
        if (method !== "HEAD") {
            response.write("{}");
        }
        response.end();
        endTimer({outcome: "dropped"});
    }

    private async handlePost(room: BridgedRoom, params: {[key: string]: string|string[]}) {
        // We can't easily query the name of a channel from its ID, but we can
        // infer its current name every time we receive a message, because slack
        // tells us.
        const channelName = `${params.team_domain}.#${params.channel_name}`;

        const teamId = params.team_id as string;

        room.SlackChannelName = channelName;
        if (room.isDirty) {
            await this.main.datastore.upsertRoom(room);
        }

        // TODO(paul): This will reject every bot-posted message, both our own
        //   reflections and other messages from other bot integrations. It would
        //   be nice if we could distinguish the two by somehow learning our own
        //   'bot_id' parameter.
        //     https://github.com/matrix-org/matrix-appservice-slack/issues/29
        if (params.user_id === "USLACKBOT") {
            return;
        }

        // Only count received messages that aren't self-reflections
        this.main.incCounter("received_messages", {side: "remote"});

        if (!room.SlackClient) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + params.team_domain);

            if (params.text) {
                // Converting params to an object here, as we assume that params is the right shape.
                return room.onSlackMessage(params as unknown as ISlackMessageEvent, teamId);
            }
            return;
        }

        const text = params.text as string;
        const lookupRes = await this.lookupMessage(
            params.channel_id as string,
            params.timestamp as string,
            room.SlackClient,
        );

        if (!lookupRes.message) {
            // Converting params to an object here, as we assume that params is the right shape.
            lookupRes.message = params as unknown as ISlackMessageEvent;
        }

        // Restore the original parameters, because we've forgotten a lot of
        // them by now
        PRESERVE_KEYS.forEach((k) => lookupRes.message[k] = params[k]);
        lookupRes.message.text = await this.doChannelUserReplacements(lookupRes.message, text, room.SlackClient);
        return room.onSlackMessage(lookupRes.message, teamId, lookupRes.content);
    }

    private async handleAuthorize(roomOrToken: BridgedRoom|string, params: {[key: string]: string|string[]}) {
        const oauth2 = this.main.oauth2;
        if (!oauth2) {
            log.warn("Wasn't expecting to receive /authorize without OAuth2 configured");
            return {
                code: 500,
                html: `OAuth is not configured on this bridge.`,
            };
        }
        let room: BridgedRoom|null = null;
        let user: string|null = null;
        if (typeof roomOrToken === "string") {
            user = oauth2.getUserIdForPreauthToken(roomOrToken);
            // This might be a user token.
            if (!user) {
                return {
                    code: 500,
                    html: "Token not known.",
                };
            }
        } else {
            room = roomOrToken;
        }

        log.debug("Exchanging temporary code for full OAuth2 token " +
            (user ? user : room!.InboundId),
        );

        try {
            const { response, access_scopes } = await oauth2.exchangeCodeForToken(
                params.code as string,
                roomOrToken,
            );
            log.debug("Got a full OAuth2 token");
            if (room) { // Legacy webhook
                room.updateAccessToken(response.access_token, new Set(access_scopes));
                await this.main.datastore.upsertRoom(room);
            } else if (user) { // New event api
                await this.main.setUserAccessToken(
                    user,
                    response.team_id,
                    response.user_id,
                    response.access_token,
                );
                this.main.datastore.upsertTeam(
                    response.team_id,
                    response.team_name,
                    response.bot!.bot_user_id,
                    response.bot!.bot_access_token,
                );
            }
        } catch (err) {
            log.error("Error during handling of an oauth token:", err);
            return {
                code: 403,
                // Not using templaes to avoid newline awfulness.
                // tslint:disable-next-line: prefer-template
                html: "<h2>Integration Failed</h2>\n" +
                "<p>Unfortunately your channel integration did not go as expected...</p>",
            };
        }
        return {
            // Not using templaes to avoid newline awfulness.
            // tslint:disable-next-line: prefer-template
            html: `<h2>Integration Successful!</h2>\n` +
                  `<p>Your Matrix-Slack ${room ? "channel integration" : "account" } is now correctly authorized.</p>`,
        };
    }

    /**
     * Attempts to handle a message received from a slack webhook request.
     *
     * The webhook request that we receive doesn't have enough information to richly
     * represent the message in Matrix, so we look up more details.
     *
     * @throws If the message failed to be looked up, or collided with another event
     * sent at the same microsecond.
     * @param {string} channelID Slack channel ID.
     * @param {string} timestamp Timestamp when message was received, in seconds
     *     formatted as a float.
     */
    private async lookupMessage(channelID: string, timestamp: string, client: WebClient): Promise<{
        // tslint:disable-next-line: no-any
        message: ISlackMessageEvent, content: Buffer|undefined}> {
        // Look up all messages at the exact timestamp we received.
        // This has microsecond granularity, so should return the message we want.
        const response = (await client.conversations.history({
            channel: channelID,
            inclusive: true,
            latest: timestamp,
            oldest: timestamp,
        })) as ConversationsHistoryResponse;

        if (!response.ok || !response.messages || response.messages.length === 0) {
            log.warn("Could not find history: " + response);
            throw Error("Could not find history");
        }
        if (response.messages.length !== 1) {
            // Just laziness.
            // If we get unlucky and two messages were sent at exactly the
            // same microsecond, we could parse them all, filter by user,
            // filter by whether they have attachments, and such, and pick
            // the right message. But this is unlikely, and I'm lazy, so
            // we'll just drop the message...
            log.warn(`Really unlucky, got multiple messages at same microsecond, dropping:`, response);
            throw Error("Collision");
        }
        const message = response.messages[0];
        log.debug("Looked up message from history as " + JSON.stringify(message));

        if (message.subtype === "file_share") {
            try {
                message.file = await this.enablePublicSharing(message.file!, client);
                const content = await this.fetchFileContent(message.file!);
                return { message, content };
            } catch (err) {
                log.error("Failed to get file content: ", err);
                // Fall through here and handle like a normal message.
            }
        }

        return { message, content: undefined };
    }
}
