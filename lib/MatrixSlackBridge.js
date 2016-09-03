"use strict";

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;

var SlackHookHandler = require("./SlackHookHandler");
var MatrixHandler = require("./matrix-handler");
var BridgedRoom = require("./BridgedRoom");

function MatrixSlackBridge(config) {
    var self = this;

    this._config = config;

    this._rooms = [];

    config.rooms.forEach((room_config) => {
        this._rooms.push(new BridgedRoom({
            bridge: this,

            matrix_room_id: room_config.matrix_room_id,
            slack_channel_id: room_config.slack_channel_id,
            slack_token: room_config.slack_api_token,
            slack_webhook_uri: room_config.webhook_url,
        }));
    });

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
                        self.getBotIntent().join(ev.room_id);
                    }

                    return;
                }

                self._matrixHandler.handle(request.getData());
            },
        }
    });

    this._matrixHandler = new MatrixHandler(config, this);

    this._slackHookHandler = new SlackHookHandler(config, this);
}

MatrixSlackBridge.prototype.getBotIntent = function() {
    return this._bridge.getIntent();
};

MatrixSlackBridge.prototype.getIntentForSlackUsername = function(slackUser) {
    var username = "@" + this._config.username_prefix + slackUser +
        ":" + this._config.homeserver.server_name;
    return this._bridge.getIntent(username);
};

MatrixSlackBridge.prototype.getRoomBySlackChannelId = function(channel_id) {
    var rooms = this._rooms;
    for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].slack_channel_id === channel_id) return rooms[i];
    }
    return null;
};

MatrixSlackBridge.prototype.getRoomByMatrixRoomId = function(room_id) {
    var rooms = this._rooms;
    for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].matrix_room_id === room_id) return rooms[i];
    }
    return null;
};

MatrixSlackBridge.prototype.run = function(port) {
    var config = this._config;

    this._slackHookHandler.startAndListen(
        config.slack_hook_port, config.tls
    ).then(() => {
        this._bridge.run(port, config);
    });
}

module.exports = MatrixSlackBridge;
