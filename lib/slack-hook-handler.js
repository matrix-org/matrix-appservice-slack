"use strict";

var substitutions = require("./substitutions");

/**
 * @constructor
 * @param {request} requestLib request library, for sending HTTP requests.
 * @param {Object} config the configuration of the bridge.
 *     See ../config/slack-config-schema.yaml for the schema to which this must conform.
 * @param {Rooms} rooms mapping of all known slack channels to matrix rooms.
 * @param {Bridge} bridge the matrix-appservice-bridge bridge through which to
 *     communicate with matrix.
 */
function SlackHookHandler(requestLib, config, rooms, bridge) {
    this.requestLib = requestLib;
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
 * @param {string} params.channel_id Slack channel ID receiving the message.
 * @param {string} params.channel_name Slack channel name receiving the message.
 * @param {string} params.user_id Slack user ID of user sending the message.
 * @param {string} params.user_name Slack user name of the user sending the message.
 * @param {?string} params.text Text contents of the message, if a text message.
 * @param {string} timestamp Timestamp when message was received, in seconds
 *     formatted as a float.
 */
SlackHookHandler.prototype.handle = function(params) {
    if (params.user_id === "USLACKBOT") {
        return;
    }
    if (!this.rooms.knowsSlackChannel(params.channel_id)) {
        console.log("Ignoring message for slack channel with unknown matrix ID: %s (%s)",
            params.channel_id, params.channel_name
        );
        return;
    }
    var intent = this.getIntent(params.user_name);
    var roomID = this.rooms.matrixRoomID(params.channel_id);
    if (params.text) {
        intent.sendText(roomID, substitutions.slackToMatrix(params.text));
        return;
    }
    // Attachments are never sent to a webhook, so we need to actually request
    // the message history of the room to get information about attachments.
    this.lookupAndSendNonTextMessage(params.channel_id, params.timestamp, intent, roomID);
    return;
};

/**
 * Attempts to handle a non-text message received from a slack webhook request.
 *
 * @param {string} channelID Slack channel ID.
 * @param {string} timestamp Timestamp when message was received, in seconds
 *     formatted as a float.
 * @param {Intent} intent Intent for sending messages as the relevant user.
 * @param {string} roomID Matrix room ID associated with channelID.
 */
SlackHookHandler.prototype.lookupAndSendNonTextMessage =
        function(channelID, timestamp, intent, roomID) {
    if (!this.config.slack_master_token) {
        return;
    }
    // Look up all messages at the exact timestamp we received.
    // This has microsecond granularity, so should return the message we want.
    var params = {
        channel: channelID,
        latest: timestamp,
        oldest: timestamp,
        inclusive: "1",
        token: this.config.slack_master_token,
    };
    var self = this;
    this.requestLib.post("https://slack.com/api/channels.history", {form: params},
            function(err, _, body) {
        if (err) {
            console.log("Error looking up history: %s", err);
        }
        else {
            var resp = JSON.parse(body);
            if (!resp.ok || !resp.messages) {
                console.log("Could not find history: " + body);
                return;
            }
            if (resp.messages.length != 1) {
                // Just laziness.
                // If we get unlucky and two messages were sent at exactly the
                // same microsecond, we could parse them all, filter by user,
                // filter by whether they have attachments, and such, and pick
                // the right message. But this is unlikely, and I'm lazy, so
                // we'll just drop the message...
                console.log("Really unlucky, got multiple messages at same" +
                    " microsecond, dropping:" + body);
                return;
            }
            var message = resp.messages[0];
            if (!message.file) {
                console.log("Ignoring non-text non-image message: " + body);
                return;
            }
            if (message.file.mimetype && message.file.mimetype.indexOf("image/") === 0) {
                var matrixMessage = self.slackImageToMatrixImage(message.file);
                intent.sendMessage(roomID, matrixMessage);
                if (message.file.initial_comment) {
                    var text = substitutions.slackToMatrix(
                        message.file.initial_comment.comment
                    );
                    intent.sendText(roomID, text);
                }
                return;
            }
            console.log("Ignoring non-image attachment: " + body);
        }
    });
};

/**
 * Converts a slack image attachment to a matrix image event.
 *
 * @param {Object} file The slack image attachment file object.
 * @return {Object} Matrix event content.
 */
SlackHookHandler.prototype.slackImageToMatrixImage = function(file) {
    var message = {
        msgtype: "m.image",
        url: file.url,
        body: file.title,
        info: {
            mimetype: file.mimetype
        }
    };
    if (file.original_w) {
        message.info.w = file.original_w;
    }
    if (file.original_h) {
        message.info.h = file.original_h;
    }
    if (file.size) {
        message.info.size = file.size;
    }
    if (file.thumb_360) {
        message.thumbnail_url = file.thumb_360;
        message.thumbnail_info = {};
        if (file.thumb_360_w) {
            message.thumbnail_info.w = file.thumb_360_w;
        }
        if (file.thumb_360_h) {
            message.thumbnail_info.h = file.thumb_360_h;
        }
    }
    return message;
};

SlackHookHandler.prototype.checkAuth = function(params) {
    return params.token &&
        params.token === this.rooms.tokenForSlackChannel(params.channel_id);
};

module.exports = SlackHookHandler;
