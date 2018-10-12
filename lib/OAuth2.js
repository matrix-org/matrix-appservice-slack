"use strict";

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
    "bot"
];

class OAuth2 {
    constructor(opts) {
        this._main = opts.main;

        this._userTokensWaiting = new Map(); //token -> userId
        this._client_id = opts.client_id;
        this._client_secret = opts.client_secret;
        this._redirect_prefix = opts.redirect_prefix;
    }

    makeRedirectURL(roomOrString) {
        if (typeof roomOrString !== "string") {
            roomOrString = roomOrString.getInboundId();
        }
        return `${this._redirect_prefix}${roomOrString}/authorize`;
    }

    makeAuthorizeURL(opts) {
        var redirect_uri = this.makeRedirectURL(opts.room);
        let scopes = Array.from(REQUIRED_SCOPES);
        if (typeof opts.room === "string") {
            scopes = scopes.concat(BOT_SCOPES);
        }

        var qs = querystring.stringify({
            client_id: this._client_id,
            scope: scopes.join(","),
            redirect_uri: redirect_uri,
            state: opts.state,
        });

        return "https://slack.com/oauth/authorize?" + qs;
    }

    exchangeCodeForToken (opts) {
        const redirect_uri = this.makeRedirectURL(opts.room);
        this._main.incRemoteCallCounter("oauth.access");
        return rp({
            uri: "https://slack.com/api/oauth.access",
            qs: {
                client_id: this._client_id,
                client_secret: this._client_secret,
                code: opts.code,
                redirect_uri: redirect_uri,
            },
            json: true
        }).then((response) => {
            if (!response.ok) {
                log.error("oauth.access failed: ", response);
                return Promise.reject("OAuth2 process failed: '" + response.error + "'");
            }
            response.access_scopes =  response.scope.split(/,/);
            return response;
        });
    }

    // Authenticating users is a bit tricky:
    // Scalar calls getPreauthToken(userId) to get a token (to map the token to the user)
    // Scalar provides that token to slack.
    // Slack send that token to us.
    // We store the user token in the user's

    getPreauthToken (userId) {
        // NOTE: We use 32 because we need to use it into SlackEventHandler which
        // expects inbound roomIds to be 32 chars.
        const token = uuid().substr(0,32);
        this._userTokensWaiting.set(token, userId);
        return token;
    }

    getUserIdForPreauthToken(token, pop = true) {
        const v =  this._userTokensWaiting.get(token);
        if (v && pop) {
            this._userTokensWaiting.delete(token);
        }
        return v;
    }
}

OAuth2.prototype

module.exports = OAuth2;
