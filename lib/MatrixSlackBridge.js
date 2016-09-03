"use strict";

var qs = require("querystring");

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;

var Rooms = require("./rooms");

var SlackHookHandler = require("./SlackHookHandler");
var MatrixHandler = require("./matrix-handler");

function MatrixSlackBridge(config) {
    var self = this;

    var rooms = new Rooms(config);

    this._config = config;

    this._bridge = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.server_name,
        registration: "slack-registration.yaml",

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additonal data
            },

            onEvent: function(request, context) {
                var ev = request.getData();

                if (ev.type === "m.room.member" &&
                        ev.state_key === bridge.getBot().getUserId()) {
                    // A membership event about myself
                    var membership = ev.content.membership;
                    if (membership === "invite") {
                        // Automatically accept all invitations
                        self._bridge.getIntent().join(ev.room_id);
                    }

                    return;
                }

                self._matrixHandler.handle(request.getData());
            },
        }
    });

    this._matrixHandler = new MatrixHandler(config, rooms, this._bridge);

    this._slackHookHandler = new SlackHookHandler(config, rooms, this._bridge);
}

MatrixSlackBridge.prototype.run = function(port) {
    var self = this;
    var config = this._config;

    startServer(config, this._slackHookHandler, function() {
        self._bridge.run(port, config);
    });
}

function startServer(config, hookHandler, callback) {
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

module.exports = MatrixSlackBridge;
