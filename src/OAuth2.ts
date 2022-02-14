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
import { v4 as uuid } from "uuid";
import { Logging } from "matrix-appservice-bridge";
import { Main, METRIC_OAUTH_SESSIONS } from "./Main";
import { INTERNAL_ID_LEN } from "./BaseSlackHandler";
import { WebClient } from "@slack/web-api";
import { OAuthAccessResponse } from "./SlackResponses";
import { Template, compile } from "nunjucks";
import { promises as fs } from "fs";
import * as path from "path";

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

const TOKEN_EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

export class OAuth2 {
    private readonly main: Main;
    private readonly userTokensWaiting: Map<string, {userId: string; expireAfter: number}>;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectPrefix: string;
    private readonly client: WebClient;
    private readonly templateFile: string;
    private oauthTemplate!: Template;

    constructor(opts: {main: Main, client_id: string, client_secret: string, redirect_prefix: string, template_file: string}) {
        this.main = opts.main;
        this.userTokensWaiting = new Map(); // token -> userId
        this.clientId = opts.client_id;
        this.clientSecret = opts.client_secret;
        this.redirectPrefix = opts.redirect_prefix;
        this.client = new WebClient();
        this.templateFile = opts.template_file;
        // Precompile oauth templates
    }

    public async compileTemplates(): Promise<void> {
        this.oauthTemplate = compile(await fs.readFile(path.resolve(this.templateFile), "utf-8"));
    }

    public makeAuthorizeURL(token: string, state: string, isPuppeting = false): string {
        const redirectUri = this.makeRedirectURL(token);
        const scopes = isPuppeting ? PUPPET_SCOPES : REQUIRED_SCOPES;

        const qs = querystring.stringify({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: scopes.join(","),
            state,
        });

        return "https://slack.com/oauth/authorize?" + qs;
    }

    public async exchangeCodeForToken(code: string, token: string)
        : Promise<{ response: OAuthAccessResponse, access_scopes: string[]} > {
        const redirectUri = this.makeRedirectURL(token);
        this.main.incRemoteCallCounter("oauth.access");
        const response = (await this.client.oauth.access({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            redirect_uri: redirectUri,
        })) as OAuthAccessResponse;
        if (response.ok) {
            this.main.incCounter(METRIC_OAUTH_SESSIONS, {result: "success", reason: "success"});
            return {
                response,
                access_scopes: response.scope.split(/,/),
            };
        }
        this.main.incCounter(METRIC_OAUTH_SESSIONS, {result: "failed", reason: "api-failure"});
        log.error("oauth.access failed: ", response);
        throw Error(`OAuth2 process failed: '${response.error}'`);
    }

    // Authenticating users is a bit tricky:
    // Scalar calls getPreauthToken(userId) to get a token (to map the token to the user)
    // Scalar provides that token to slack.
    // Slack send that token to us.
    // We store the user token in the user's

    public getPreauthToken(userId: string): string {
        // NOTE: We use 32 because we need to use it into SlackEventHandler which
        // expects inbound roomIds to be 32 chars.
        const token = uuid().substring(0, INTERNAL_ID_LEN);
        this.userTokensWaiting.set(token, {userId, expireAfter: TOKEN_EXPIRE_MS + Date.now()});
        return token;
    }

    public getUserIdForPreauthToken(token: string): string|null {
        const v = this.userTokensWaiting.get(token);
        this.userTokensWaiting.delete(token);
        if (v && v.expireAfter >= Date.now()) {
            return v.userId;
        }
        return null;
    }


    public getHTMLForResult(
        success: boolean,
        code: number,
        userId: string|null,
        reason?: "error"|"limit-reached"|"token-not-known"
    ): string {
        return this.oauthTemplate.render({
            success,
            userId,
            reason,
            code,
        });
    }

    private makeRedirectURL(token: string): string {
        return `${this.redirectPrefix.replace(/\/+$/, "")}/${token}/authorize`;
    }
}
