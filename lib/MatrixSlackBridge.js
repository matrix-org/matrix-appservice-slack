"use strict";

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
                        self.getBotIntent().join(ev.room_id);
                    }

                    return;
                }

                self._matrixHandler.handle(request.getData());
            },
        }
    });

    this._matrixHandler = new MatrixHandler(config, rooms, this);

    this._slackHookHandler = new SlackHookHandler(config, rooms, this);
}

MatrixSlackBridge.prototype.getBotIntent = function() {
    return this._bridge.getIntent();
};

MatrixSlackBridge.prototype.getIntentForSlackUsername = function(slackUser) {
    var username = "@" + this._config.username_prefix + slackUser +
        ":" + this._config.homeserver.server_name;
    return this._bridge.getIntent(username);
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
