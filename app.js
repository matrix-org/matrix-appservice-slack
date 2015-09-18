// Usage:
// node app.js -r -c config.yaml -u "http://localhost:9000" # remember to add the registration!
// node app.js -p 9000 -c config.yaml
var qs = require("querystring");
var requestLib = require("request");
var Rooms = require("./lib/rooms");
var bridgeLib = require("matrix-appservice-bridge");
var bridge;

function startServer(config, rooms, callback) {
    var createServer;
    if (config.tls) {
        var fs = require("fs");
        var tls_options = {
            key: fs.readFileSync(config.tls.key_file),
            cert: fs.readFileSync(config.tls.crt_file)
        };
        createServer = function(cb) { return require("https").createServer(tls_options, cb); };
    } else {
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
            if (params.user_id !== "USLACKBOT") {
                var intent = bridge.getIntent("@" + config.username_prefix + params.user_name + ":" + config.homeserver.server_name);
                if (rooms.knowsSlackChannel(params["channel_id"])) {
                    var roomID = rooms.matrixRoomID(params["channel_id"]);
                    if (roomID) {
                        intent.sendText(roomID, params.text);
                    } else {
                        console.log(
                            "Ignoring message for slack channel " +
                            "with unknown matrix ID: " + params["channel_id"] +
                            " (" + params["channel_name"] + ")"
                        );
                    }
                }
            }
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({}));
            response.end();
        });
    }).listen(config.slack_hook_port, function() {
        var protocol = config.tls ? "https" : "http";
        console.log("Slack-side listening on port " + config.slack_port + " over " + protocol);
        callback();
    });
}

var Cli = bridgeLib.Cli;
var Bridge = bridgeLib.Bridge;
var AppServiceRegistration = bridgeLib.AppServiceRegistration;

new Cli({
    registrationPath: "slack-registration.yaml",
    bridgeConfig: {
        schema: "config/slack-config-schema.yaml",
        affectsRegistration: true
    },
    generateRegistration: function(appServiceUrl, callback) {
        var config = Cli.getConfig();
        var reg = new AppServiceRegistration(appServiceUrl);
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(config.bot_username);
        reg.addRegexPattern("users", "@" + config.username_prefix + ".*", true);
        callback(reg);
    },
    run: function(port, config) {
        var rooms = new Rooms(config);
        startServer(config, rooms, function() {
            bridge = new Bridge({
                homeserverUrl: config.homeserver.url,
                domain: config.homeserver.server_name,
                registration: "slack-registration.yaml",

                controller: {
                    onUserQuery: function(queriedUser) {
                        return {}; // auto-provision users with no additonal data
                    },

                    onEvent: function(request, context) {
                        var event = request.getData();
                        if (event.type !== "m.room.message" || !event.content) {
                            return;
                        }
                        var hookURL = rooms.webhookForMatrixRoomID(event.room_id);
                        if (!hookURL) {
                            console.log("Ignoring event for matrix room with unknown slack channel:" + event.room_id);
                            return;
                        }
                        requestLib({
                            method: "POST",
                            json: true,
                            uri: hookURL,
                            body: {
                                username: event.user_id,
                                text: event.content.body
                            }
                        }, function(err, res) {
                            if (err) {
                                console.log("HTTP Error: %s", err);
                            }
                            else {
                                console.log("HTTP %s", res.statusCode);
                            }
                        });
                    }
                }
            });
            console.log("Matrix-side listening on port %s", port);
            bridge.run(port, config);
        });
    }
}).run();
