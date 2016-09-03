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
    this._roomsBySlackChannelId = {};
    this._roomsByMatrixRoomId = {};

    config.rooms.forEach((room_config) => {
        var room = new BridgedRoom({
            bridge: this,

            matrix_room_id: room_config.matrix_room_id,
            slack_channel_id: room_config.slack_channel_id,
            slack_token: room_config.slack_api_token,
            slack_webhook_uri: room_config.webhook_url,
        });

        this._rooms.push(room);
        this._roomsBySlackChannelId[room.slack_channel_id] = room;
        this._roomsByMatrixRoomId[room.matrix_room_id] = room;
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
                self.onMatrixEvent(ev);
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
    return this._roomsBySlackChannelId[channel_id];
};

MatrixSlackBridge.prototype.getRoomByMatrixRoomId = function(room_id) {
    return this._roomsByMatrixRoomId[room_id];
};

MatrixSlackBridge.prototype.onMatrixEvent = function(ev) {
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

    this._matrixHandler.handle(ev);
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
