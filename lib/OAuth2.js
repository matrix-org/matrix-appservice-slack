"use strict";

var querystring = require("querystring");
var rp = require('request-promise');

// The full set of OAuth2 scopes we currently require for all functionality
var REQUIRED_SCOPES = [
    "team:read",
    "users:read",
    "channels:history",
    "channels:read",
    "files:write:user",
];

function OAuth2(opts) {
    this._bridge = opts.bridge,

    this._client_id = opts.client_id;
    this._client_secret = opts.client_secret;
    this._redirect_prefix = opts.redirect_prefix;
}

OAuth2.prototype.makeRedirectURL = function(room) {
    return this._redirect_prefix + room.getInboundId() + "/authorize";
};

OAuth2.prototype.makeAuthorizeURL = function(opts) {
    var redirect_uri = this.makeRedirectURL(opts.room);

    var qs = querystring.stringify({
        client_id: this._client_id,
        scope: REQUIRED_SCOPES.join(" "),
        redirect_uri: redirect_uri,
        state: opts.state,
    });

    return "https://slack.com/oauth/authorize?" + qs;
};

OAuth2.prototype.exchangeCodeForToken = function(opts) {
    var redirect_uri = this.makeRedirectURL(opts.room);

    this._bridge.incRemoteCallCounter("oauth.access");
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
            console.log("oauth.access failed: ", response);
            return Promise.reject("OAuth2 process failed: '" + response.error + "'");
        }

        return {
            auth_token: response.access_token,
            auth_scopes: response.scope.split(/,/),
        };
    });
};

module.exports = OAuth2;
