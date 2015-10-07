// Usage:
// The first time, run this first to register with your homeserver:
// node app.js -r -c config.yaml -u "http://localhost:9000"
// And any time after that:
// node app.js -p 9000 -c config.yaml
var qs = require("querystring");
var requestLib = require("request");
var Rooms = require("./lib/rooms");
var SlackHookHandler = require("./lib/slack-hook-handler");
var Oauth = require("./lib/slack/oauth");
var MatrixHandler = require("./lib/matrix-handler");
var EchoSuppresser = require("./lib/echosuppresser");
var bridgeLib = require("matrix-appservice-bridge");
var urllib = require("url");
var bridge;

function startServer(config, hookHandler, oauth, callback) {
    var createServer;
    if (config.tls) {
        var fs = require("fs");
        var tls_options = {
            key: fs.readFileSync(config.tls.key_file),
            cert: fs.readFileSync(config.tls.crt_file)
        };
        createServer = function(cb) {
            return require("https").createServer(tls_options, cb);
        };
    }
    else {
        createServer = require("http").createServer;
    }

    createServer(function(request, response) {
        console.log(request.method + " " + request.url);

        var body = "";
        request.on("data", function(chunk) {
            body += chunk;
        });

        request.on("end", function() {
            var url = urllib.parse(request.url, /*parseQuery=*/true);
            if (url.pathname == "/oauth/slack/req") {
                if (url.query.mxid) {
                    console.log(url.query.mxid);
                    response.writeHead(302, {"Location": oauth.urlFor(url.query.mxid)});
                }
                else {
                    response.writeHead(400, {"Content-Type": "text/plain"});
                    response.write("Missing query param: mxid");
                }
                response.end();
                return;
            }
            else if (url.pathname == "/oauth/slack/callback") {
                oauth.onCallback(request, response);
                return;
            }
            else if (url.pathname == "/oauth/slack/404") {
                response.writeHead(404, {"Content-Type": "text/plain"});
                response.write("Oauth not enabled");
                response.end();
                return;
            }

            var params = qs.parse(body);
            if (hookHandler.checkAuth(params)) {
                hookHandler.handle(params);
            }
            else {
                console.log("Ignoring request with bad token: " + JSON.stringify(params));
            }
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({}));
            response.end();
        });
    }).listen(config.slack_hook_port, function() {
        var protocol = config.tls ? "https" : "http";
        console.log("Slack-side listening on port " +
            config.slack_hook_port + " over " + protocol);
        callback();
    });
}

var Cli = bridgeLib.Cli;
var Bridge = bridgeLib.Bridge;
var AppServiceRegistration = bridgeLib.AppServiceRegistration;


var cli = new Cli({
    registrationPath: "slack-registration.yaml",
    bridgeConfig: {
        schema: "config/slack-config-schema.yaml",
        affectsRegistration: true
    },
    generateRegistration: function(reg, callback) {
        var config = cli.getConfig();
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(config.bot_username);
        reg.addRegexPattern("users", "@" + config.username_prefix + ".*", true);
        callback(reg);
    },
    run: function(port, config) {
        var rooms = new Rooms(config);
        var echoSuppresser = new EchoSuppresser();
        var oauth = makeOauth(config);
        var matrixHandler = new MatrixHandler(
            config, rooms, requestLib, echoSuppresser, oauth
        );
        bridge = new Bridge({
            homeserverUrl: config.homeserver.url,
            domain: config.homeserver.server_name,
            registration: "slack-registration.yaml",
            clientUsers: config.users,

            controller: {
                onUserQuery: function(queriedUser) {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: function(request, context) {
                    matrixHandler.handle(request.getData());
                },
            }
        });
        var slackHookHandler = new SlackHookHandler(
            requestLib, config, rooms, bridge, echoSuppresser
        );
        startServer(config, slackHookHandler, oauth, function() {
            console.log("Matrix-side listening on port %s", port);
            bridge.run(port, config);
        });
    }
});
cli.run();

function makeOauth(config) {
    if (!config.oauth.slack.client_id || !config.oauth.slack.client_secret) {
        console.log(JSON.stringif(config));
        return Oauth.NO_OAUTH;
    }
    return new Oauth(
        config.oauth.slack.client_id,
        config.oauth.slack.client_secret,
        "https://" + config.homeserver.server_name + ":" + config.slack_hook_port +
            "/oauth/slack/callback"
    );
}
