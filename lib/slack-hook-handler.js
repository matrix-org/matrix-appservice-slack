"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');

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
    console.log("Received slack webhook request: " + JSON.stringify(params));
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
    var team_domain = params.team_domain;

    intent.setDisplayName(params.user_name);

    if (!this.config["slack_token_" + team_domain]) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        console.log("no slack token for " + team_domain);

        if (params.text) {
            intent.sendText(roomID, substitutions.slackToMatrix(params.text));
        }
        return;
    }
    var token = this.config["slack_token_" + team_domain];

    this.lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
    return;
};

/**
 * Attempts to handle a message received from a slack webhook request.
 *
 * The webhook request that we receive doesn't have enough information to richly
 * represent the message in Matrix, so we look up more details.
 *
 * @param {string} channelID Slack channel ID.
 * @param {string} timestamp Timestamp when message was received, in seconds
 *     formatted as a float.
 * @param {Intent} intent Intent for sending messages as the relevant user.
 * @param {string} roomID Matrix room ID associated with channelID.
 */
SlackHookHandler.prototype.lookupAndSendMessage =
        function(channelID, timestamp, intent, roomID, token) {
    
    // Look up all messages at the exact timestamp we received.
    // This has microsecond granularity, so should return the message we want.
    var params = {
        channel: channelID,
        latest: timestamp,
        oldest: timestamp,
        inclusive: "1",
        token: token
    };
    var self = this;
    this.requestLib.post("https://slack.com/api/channels.history", {form: params},
            function(err, _, body) {
        if (err) {
            console.log("Error looking up history: %s", err);
            return;
        }
        var resp = JSON.parse(body);
        if (!resp.ok || !resp.messages || resp.messages.length === 0) {
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
        console.log("Looked up message from history as " + JSON.stringify(message));

        // if someone mentions #CHANNEL, slack sends the ID, so we need to look up the channel name before continuing:
        var testForName = message.text.match(/<#(\w+?)>/g);
        if (null == testForName) {
            // no #CHANNELS mentioned, what about @USERS?
            var testForName = message.text.match(/<@(\w+?)>/g);
            if (null == testForName) {
                // nope; just send msg
                sendMessage(message, body, intent, roomID, self);
            }
            else {
                substituteUserMentionsAndSendMessage(message, body, intent, roomID, self, token, testForName, 0);
            }

        }
        else {
            substituteChannelAndUserMentionsAndSendMessage(message, body, intent, roomID, self, token, testForName, 0);
        }
    });
};

var substituteChannelAndUserMentionsAndSendMessage = function(message, body, intent, roomID, self, token, testForName, iteration) {
    if (iteration < testForName.length) {
        // use the channels.info api to convert ID to name; first change ID from <#foo> to foo
        var id = testForName[iteration].slice(2, -1);
        var options = {
            uri: 'https://slack.com/api/channels.info',
            qs: {
                token: token,
                channel: id
            },
            json: true // return as json
        };
        rp(options).then(function(res) {
            if (res && res.channel && res.channel.name) {
                console.log("channels.info: ID " + id + " mapped to " + res.channel.name);
                message.text = message.text.replace(/<#(\w+?)>/, "#" + res.channel.name);
            }
            else {
                console.log("channels.info returned no result for " + id);
            }
            iteration++;
            substituteChannelAndUserMentionsAndSendMessage(message, body, intent, roomID, self, token, testForName, iteration);
        }).catch(function(err) {
           console.log("Caught error " + err);
        });
    }
    else {
        var testForName = message.text.match(/<@(\w+?)>/g);
        if (null == testForName) {
            sendMessage(message, body, intent, roomID, self);
        }
        else {
            substituteUserMentionsAndSendMessage(message, body, intent, roomID, self, token, testForName, 0);
        }
    }
};

var substituteUserMentionsAndSendMessage = function(message, body, intent, roomID, self, token, testForName, iteration) {

	if (iteration < testForName.length) {

        // use the users.info api to convert ID to name; first change ID from <@foo> to foo
        var id = testForName[iteration].slice(2, -1);
        var options = {
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: token,
                user: id
            },
            json: true // return as json
        };
        rp(options).then(function(res) {
            if (res && res.user && res.user.name) {
                console.log("users.info: ID " + id + " mapped to " + res.user.name);
                message.text = message.text.replace(/<@(\w+?)>/, res.user.name);
            }
            else {
                console.log("users.info returned no result for " + id);
            }
            iteration++;
            substituteUserMentionsAndSendMessage(message, body, intent, roomID, self, token, testForName, iteration);
        }).catch(function(err) {
           console.log("Caught error " + err);
        });
    }
    else {
        sendMessage(message, body, intent, roomID, self);
    }
};

var sendMessage = function(message, body, intent, roomID, self) {
    if (!message.subtype) {
        intent.sendText(roomID, substitutions.slackToMatrix(message.text));
    }
    else if (message.subtype === "me_message") {
        intent.sendMessage(roomID, {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        });
    }
    else if (message.subtype === "file_share") {
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
        }
    }
    else {
        console.log("Ignoring non-image attachment: " + body);
    }
};


/**
 * Converts a slack image attachment to a matrix image event.
 *
 * @param {Object} file The slack image attachment file object.
 * @param {string} file.url URL of the file.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {?integer} file.size size of the file in bytes.
 * @param {?integer} file.original_w width of the file if an image, in pixels.
 * @param {?integer} file.original_h height of the file if an image, in pixels.
 * @param {?string} file.thumb_360 URL of a 360 pixel wide thumbnail of the
 *     file, if an image.
 * @param {?integer} file.thumb_360_w width of the thumbnail of the 360 pixel
 *     wide thumbnail of the file, if an image.
 * @param {?integer} file.thumb_360_h height of the thumbnail of the 36 pixel
 *     wide thumbnail of the file, if an image.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/#m-image
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
