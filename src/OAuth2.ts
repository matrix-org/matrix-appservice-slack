import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";

const querystring = require("querystring");
const rp = require('request-promise');
const log = require("matrix-appservice-bridge").Logging.get("OAuth2");
const uuid = require('uuid/v4'); 

// The full set of OAuth2 scopes we currently require for all functionality
const REQUIRED_SCOPES = [
    "team:read",
    "users:read",
    "channels:history",
    "channels:read",
    "files:write:user",
    "chat:write:bot",
    "users:read",
];

const BOT_SCOPES = [
    "bot",
];

export class OAuth2 {
    private readonly main: Main;
    private readonly userTokensWaiting: Map<string,string>;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectPrefix: string;

    constructor(opts: {main: Main, client_id: string, client_secret: string, redirect_prefix: string}) {
        this.main = opts.main;
        this.userTokensWaiting = new Map(); //token -> userId
        this.clientId = opts.client_id;
        this.clientSecret = opts.client_secret;
        this.redirectPrefix = opts.redirect_prefix;
    }

    public makeAuthorizeURL(room: string|BridgedRoom, state: string) {
        const redirectUri = this.makeRedirectURL(room);
        let scopes = Array.from(REQUIRED_SCOPES);
        // XXX: Why do we do this?
        if (typeof room === "string") {
            scopes = scopes.concat(BOT_SCOPES);
        }

        const qs = querystring.stringify({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: scopes.join(","),
            state,
        });

        return "https://slack.com/oauth/authorize?" + qs;
    }

    public async exchangeCodeForToken (opts: {code: string, room: string}) {
        const redirect_uri = this.makeRedirectURL(opts.room);
        this.main.incRemoteCallCounter("oauth.access");
        const response = await rp({
            uri: "https://slack.com/api/oauth.access",
            qs: {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: opts.code,
                redirect_uri: redirect_uri,
            },
            json: true
        });
        if (response.ok) {
            response.access_scopes = response.scope.split(/,/);
            return response;
        }
        log.error("oauth.access failed: ", response);
        throw `OAuth2 process failed: '${response.error}'`;
    }

    // Authenticating users is a bit tricky:
    // Scalar calls getPreauthToken(userId) to get a token (to map the token to the user)
    // Scalar provides that token to slack.
    // Slack send that token to us.
    // We store the user token in the user's

    public getPreauthToken (userId: string) {
        // NOTE: We use 32 because we need to use it into SlackEventHandler which
        // expects inbound roomIds to be 32 chars.
        const token = uuid().substr(0, 32);
        this.userTokensWaiting.set(token, userId);
        return token;
    }

    public getUserIdForPreauthToken(token: string, pop = true) {
        const v =  this.userTokensWaiting.get(token);
        if (v && pop) {
            this.userTokensWaiting.delete(token);
        }
        return v || null;
    }

    private makeRedirectURL(roomOrString: string| {InboundId: string}) {
        if (typeof roomOrString !== "string") {
            roomOrString = roomOrString.InboundId;
        }
        return `${this.redirectPrefix}${roomOrString}/authorize`;
    }
}