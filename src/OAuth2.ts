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

import * as querystring from "querystring";
import * as uuid from "uuid/v4";
import { Logging } from "matrix-appservice-bridge";
import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";
import { INTERNAL_ID_LEN } from "./BaseSlackHandler";
import { WebClient } from "@slack/web-api";
import { OAuthAccessResponse } from "./SlackResponses";

const log = Logging.get("OAuth2");

// The full set of OAuth2 scopes we currently require for all functionality
const REQUIRED_SCOPES = [
    "team:read",
    "users:read",
    "channels:history",
    "channels:read",
    "files:write:user",
    "chat:write:bot",
    "users:read",
    "bot",
];

const PUPPET_SCOPES = [ // See https://stackoverflow.com/a/28234443
    "client",
];

export class OAuth2 {
    private readonly main: Main;
    private readonly userTokensWaiting: Map<string, string>;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectPrefix: string;
    private readonly client: WebClient;

    constructor(opts: {main: Main, client_id: string, client_secret: string, redirect_prefix: string}) {
        this.main = opts.main;
        this.userTokensWaiting = new Map(); // token -> userId
        this.clientId = opts.client_id;
        this.clientSecret = opts.client_secret;
        this.redirectPrefix = opts.redirect_prefix;
        this.client = new WebClient();
    }

    public makeAuthorizeURL(room: string|BridgedRoom, state: string, isPuppeting: boolean = false): string {
        const redirectUri = this.makeRedirectURL(room);
        const scopes = isPuppeting ? REQUIRED_SCOPES : PUPPET_SCOPES;

        const qs = querystring.stringify({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: scopes.join(","),
            state,
        });

        return "https://slack.com/oauth/authorize?" + qs;
    }

    public async exchangeCodeForToken(code: string, room: string|BridgedRoom)
    : Promise<{ response: OAuthAccessResponse, access_scopes: string[]} > {
        const redirectUri = this.makeRedirectURL(room);
        this.main.incRemoteCallCounter("oauth.access");
        const response = (await this.client.oauth.access({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            redirect_uri: redirectUri,
        })) as OAuthAccessResponse;
        if (response.ok) {
            return {
                response,
                access_scopes: response.scope.split(/,/),
            };
        }
        log.error("oauth.access failed: ", response);
        throw new Error(`OAuth2 process failed: '${response.error}'`);
    }

    // Authenticating users is a bit tricky:
    // Scalar calls getPreauthToken(userId) to get a token (to map the token to the user)
    // Scalar provides that token to slack.
    // Slack send that token to us.
    // We store the user token in the user's

    public getPreauthToken(userId: string): string {
        // NOTE: We use 32 because we need to use it into SlackEventHandler which
        // expects inbound roomIds to be 32 chars.
        const token = uuid().substr(0, INTERNAL_ID_LEN);
        this.userTokensWaiting.set(token, userId);
        return token;
    }

    public getUserIdForPreauthToken(token: string, pop = true): string|null {
        const v =  this.userTokensWaiting.get(token);
        if (v && pop) {
            this.userTokensWaiting.delete(token);
        }
        return v || null;
    }

    private makeRedirectURL(roomOrString: string| BridgedRoom): string {
        if (typeof roomOrString !== "string") {
            roomOrString = roomOrString.InboundId;
        }
        return `${this.redirectPrefix}${roomOrString}/authorize`;
    }
}
