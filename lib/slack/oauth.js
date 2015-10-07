var urllib = require("url");
var requestLib = require("request");
var oauthlib = require("simple-oauth2");
var uuid = require("node-uuid");

function Oauth(clientId, clientSecret, callbackUri) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.callbackUri = callbackUri;
    this.oauth = oauthlib({
        clientID: this.clientId,
        clientSecret: this.clientSecret,
        site: "https://slack.com",
        tokenPath: "/oauth/authorize"
    });

    this.outstandingRequests = {};
    this.matrixIdToToken = {};
}

Oauth.NO_OAUTH = new Oauth();

Oauth.prototype.slackTokenFor = function(matrixId) {
    return this.matrixIdToToken[matrixId];
};

Oauth.prototype.urlFor = function(matrixId) {
    if (!this.callbackUri) {
        return "/oauth/slack/404";
    }
    var id = uuid.v4();
    this.outstandingRequests[id] = matrixId;
    return this.oauth.authCode.authorizeURL({
        redirect_uri: this.callbackUri,
        scope: "read,post,client",
        state: id
    });
};

Oauth.prototype.onCallback = function(req, resp) {
    var url = urllib.parse(req.url, /*parseQuery=*/true);
    var code = url.query.code;
    var state = url.query.state;
    if (!this.outstandingRequests[state]) {
        error("Did not recognize ID", resp);
        return;
    }
    var matrixId = this.outstandingRequests[state];
    var slackUrl = "https://slack.com/api/oauth.access?" +
        "client_id=" + this.clientId +
        "&client_secret=" + this.clientSecret +
        "&code=" + code +
        "&redirect_uri=" + this.callbackUri;
    var self = this;
    requestLib.get(slackUrl, function(err, slackResp) {
        delete self.outstandingRequests[state];
        if (err || slackResp.statusCode != 200) {
            error(err, resp);
            return;
        }
        var body = JSON.parse(slackResp.body);
        if (!body.ok) {
            error(slackResp.body, resp);
            return;
        }
        resp.writeHead(200, {"Content-Type": "text/plain"});
        resp.write("Got token");
        resp.end();
        self.matrixIdToToken[matrixId] = body.access_token;
    });
};

function error(err, resp) {
    console.log("Error getting token: %s", JSON.stringify(err));
    resp.writeHead(400, {"Content-Type": "text/plain"});
    resp.write("Error getting token");
    resp.end();
}

module.exports = Oauth;
