// Usage:
// node app.js -r -c config.yaml -u "http://localhost:9001" # remember to add the registration!
// node app.js -p 9001 -c config.yaml
var qs = require('querystring');
var requestLib = require("request");
var yaml = require("yamljs");
var bridge;

function startServer(config, rooms, callback) {
    if ("tls" in config) {
        var fs = require("fs");
        var tls_options = {
            key: fs.readFileSync(config["tls"]["key_file"]),
            cert: fs.readFileSync(config["tls"]["crt_file"])
        };
        var createServer = function(cb) { return require("https").createServer(tls_options, cb); };
    } else {
        var createServer = require("http").createServer;
    }

    createServer(function(request, response) {
        console.log(request.method + " " + request.url);

        var body = "";
        request.on("data", function(chunk) {
            body += chunk;
        });

        request.on("end", function() {
            var params = qs.parse(body);
            var util = require('util');
            if (params.user_id !== "USLACKBOT") {
                var intent = bridge.getIntent("@" + config["username_prefix"] + params.user_name + ":" + config["homeserver"]["server_name"]);
                if (rooms.KnowsSlackChannel(params["channel_id"])) {
                    intent.sendText(rooms.MatrixRoomID(params["channel_id"]), params.text);
                }
            }
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({}));
            response.end();
        });
    }).listen(config["slack_hook_port"], function() {
        var protocol = "http";
        if ("tls" in config) {
            protocol = "https";
        }
        console.log("Slack-side listening on port " + config["slack_port"] + " over " + protocol);
        callback();
    });
}

var Cli = require("matrix-appservice-bridge").Cli;
var Bridge = require("matrix-appservice-bridge").Bridge;
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;

function Rooms(config) {
    this.slack_channels = {};
    this.matrix_rooms = {};
    for (var i = 0; i < config["rooms"].length; ++i) {
        var room = config["rooms"][i];
        this.slack_channels[room["slack_channel_id"]] = room;
        this.matrix_rooms[room["matrix_room_id"]] = room
    }
}

Rooms.prototype.KnowsSlackChannel = function(slack_channel_id) {
    return (slack_channel_id in this.slack_channels);
};

Rooms.prototype.KnowsMatrixRoom = function(matrix_room_id) {
    return (matrix_room_id in this.matrix_rooms);
};

Rooms.prototype.MatrixRoomID = function(slack_channel_id) {
    return this.slack_channels[slack_channel_id]["matrix_room_id"];
};

Rooms.prototype.WebhookForMatrixRoomId = function(matrix_room_id) {
    return this.matrix_rooms[matrix_room_id]["webhook_url"];
};

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
        reg.setSenderLocalpart(config["bot_username"]);
        reg.addRegexPattern("users", "@" + config["username_prefix"] + ".*", true);
        callback(reg);
    },
    run: function(port, config) {
        var rooms = new Rooms(config);
        startServer(config, rooms, function() {
            bridge = new Bridge({
                homeserverUrl: config["homeserver"]["url"],
                domain: config["homeserver"]["server_name"],
                registration: "slack-registration.yaml",

                controller: {
                    onUserQuery: function(queriedUser) {
                        return {}; // auto-provision users with no additonal data
                    },

                    onEvent: function(request, context) {
                        var event = request.getData();
                        if (event.type !== "m.room.message" || !event.content || !rooms.KnowsMatrixRoom(event.room_id)) {
                            return;
                        }
                        requestLib({
                            method: "POST",
                            json: true,
                            uri: rooms.WebhookForMatrixRoomId(event.room_id),
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
