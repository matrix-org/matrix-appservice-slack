"use strict";

var substitutions = require("./substitutions");

function HookHandler(config, rooms, bridge) {
    this.config = config;
    this.rooms = rooms;
    this.bridge = bridge;
}

HookHandler.prototype.getIntent = function(slackUser) {
    var username = "@" + this.config.username_prefix + slackUser +
        ":" + this.config.homeserver.server_name;
    return this.bridge.getIntent(username);
};

HookHandler.prototype.handle = function(params) {
    if (params.user_id !== "USLACKBOT") {
        var intent = this.getIntent(params.user_name);
        if (this.rooms.knowsSlackChannel(params["channel_id"])) {
            var roomID = this.rooms.matrixRoomID(params["channel_id"]);
            if (roomID) {
                intent.sendText(roomID, substitutions.slackToMatrix(params.text));
            } else {
                console.log(
                    "Ignoring message for slack channel " +
                    "with unknown matrix ID: " + params["channel_id"] +
                    " (" + params["channel_name"] + ")"
                );
            }
        }
    }
};

module.exports = HookHandler;
