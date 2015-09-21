"use strict";

var substitutions = require("./substitutions");

/**
 * @constructor
 * @param {Object} config the configuration of the bridge.
 *     See ../config/slack-config-schema.yaml for the schema to which this must conform.
 * @param {Rooms} rooms mapping of all known slack channels to matrix rooms.
 * @param {Bridge} bridge the matrix-appservice-bridge bridge through which to
 *     communicate with matrix.
 */
function SlackHookHandler(config, rooms, bridge) {
    this.config = config;
    this.rooms = rooms;
    this.bridge = bridge;
}

SlackHookHandler.prototype.getIntent = function(slackUser) {
    var username = "@" + this.config.username_prefix + slackUser +
        ":" + this.config.homeserver.server_name;
    return this.bridge.getIntent(username);
};

/**
 * Handles a slack webhook request.
 *
 * Sends a message to Matrix if it understands enough of the message to do so.
 * Attempts to make the message as native-matrix feeling as it can.
 *
 * @param {Object} params HTTP body of the webhook request, as a JSON-parsed dictionary.
 */
SlackHookHandler.prototype.handle = function(params) {
    if (params.user_id !== "USLACKBOT") {
        var intent = this.getIntent(params.user_name);
        if (this.rooms.knowsSlackChannel(params.channel_id)) {
            var roomID = this.rooms.matrixRoomID(params.channel_id);
            if (roomID) {
                intent.sendText(roomID, substitutions.slackToMatrix(params.text));
            } else {
                console.log(
                    "Ignoring message for slack channel " +
                    "with unknown matrix ID: " + params.channel_id +
                    " (" + params.channel_name + ")"
                );
            }
        }
    }
};

module.exports = SlackHookHandler;
