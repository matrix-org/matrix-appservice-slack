"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');
var Promise = require('bluebird');
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

    // TODO: store this somewhere
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

    var text = params.text;
    if (undefined == text) {
        lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
        return;
    }

    lookupMessage(params.channel_id, params.timestamp, token).then((msg) => {
        if(undefined == msg) {
            msg = params;
        }
        console.log("the msg:" + JSON.stringify(msg));
        return replaceChannelIdsWithNames(msg, token);
    }).then((msg) => {
        return replaceUserIdsWithNames(msg, token);
    }).then((msg) => {
        // we can't use .finally here as it does not get the final value, see https://github.com/kriskowal/q/issues/589
        return sendMessage(msg, intent, roomID, token);
    },
    (msg) => {
        return sendMessage(msg, intent, roomID, token);
    });
};

function replaceChannelIdsWithNames(message, token) {
    // match all channelIds
    var testForName = message.text.match(/<#(\w+)\|?\w*?>/g);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(function() {
        // Do this until there are no more channel ID matches
        return iteration < matches;
    }, function() {
        // foreach channelId, pull out the ID
        // (if this is an emote msg, the format is <#ID|name>, but in normal msgs it's just <#ID>
        var id = testForName[iteration].match(/<#(\w+)\|?\w*?>/)[1];
        var channelsInfoApiParams = {
            uri: 'https://slack.com/api/channels.info',
            qs: {
                token: token,
                channel: id
            },
            json: true
        };
        return rp(channelsInfoApiParams).then((response) => {
            if (response && response.channel && response.channel.name) {
                console.log("channels.info: " + id + " mapped to " + response.channel.name);
                message.text = message.text.replace(/<#(\w+)\|?\w*?>/, "#" + response.channel.name);
            }
            else {
                console.log("channels.info returned no result for " + id);
            }
            iteration++;
            }).catch((err) => {
               console.log("Caught error " + err);
            });
    }).then(() => {
        // Notice we can chain it because it's a Promise, 
        // this will run after completion of the promiseWhile Promise!
        return message;
    });
};

function replaceUserIdsWithNames(message, token) {
    // match all userIds
    var testForName = message.text.match(/<@(\w+)\|?\w*?>/g);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(() => {
        // Condition for stopping
        return iteration < matches;
    }, function() {
        // foreach userId, pull out the ID 
        // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
        var id = testForName[iteration].match(/<@(\w+)\|?\w*?>/)[1];
        var channelsInfoApiParams = {
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: token,
                user: id
            },
            json: true
        };
        return rp(channelsInfoApiParams).then((response) => {
            if (response && response.user && response.user.name) {
                console.log("users.info: " + id + " mapped to " + response.user.name);
                message.text = message.text.replace(/<@(\w+)\|?\w*?>/, response.user.name);
            }
            else {
                console.log("users.info returned no result for " + id);
            }
            iteration++;
            }).catch((err) => {
               console.log("Caught error " + err);
            });
    }).then(() => {
        // Notice we can chain it because it's a Promise, 
        // this will run after completion of the promiseWhile Promise!
        return message;
    });
};

// promiseWhile code from http://blog.victorquinn.com/javascript-promise-while-loop
var promiseWhile = function(condition, action) {
    var resolver = Promise.defer();

    var loop = function() {
        if (!condition()) return resolver.resolve();
        return Promise.cast(action())
            .then(loop)
            .catch(resolver.reject);
    };

    process.nextTick(loop);

    return resolver.promise;
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
//SlackHookHandler.prototype.lookupAndSendMessage =
var lookupMessage = function(channelID, timestamp, token) {
    // Look up all messages at the exact timestamp we received.
    // This has microsecond granularity, so should return the message we want.
    var params = {
        method: 'POST',
        form : {
            channel: channelID,
            latest: timestamp,
            oldest: timestamp,
            inclusive: "1",
            token: token,
        },
        uri: "https://slack.com/api/channels.history",
        json: true
    };
    return rp(params).then((response) => {
        if (!response || !response.messages || response.messages.length === 0) {
            console.log("Could not find history: " + response);
            return undefined;
        }
        if (response.messages.length != 1) {
            // Just laziness.
            // If we get unlucky and two messages were sent at exactly the
            // same microsecond, we could parse them all, filter by user,
            // filter by whether they have attachments, and such, and pick
            // the right message. But this is unlikely, and I'm lazy, so
            // we'll just drop the message...
            console.log("Really unlucky, got multiple messages at same" +
                " microsecond, dropping:" + response);
            return undefined;
        }
        var message = response.messages[0];
        console.log("Looked up message from history as " + JSON.stringify(message));
        return message;
    });
}

var lookupSharedPublicURL = function(file, token) {
    var params = {
        method: 'POST',
        form : {
            file: file.id,
            token: token,
        },
        uri: "https://slack.com/api/files.sharedPublicURL",
        json: true
    };
    return rp(params).then((response) => {
        if (!response || !response.file || !response.file.permalink_public) {
            console.log("Could not find sharedPublichURL: " + JSON.stringify(response));
            return undefined;
        }
        var file = response.file;
        console.log("Looked up sharedPublicURL as " + JSON.stringify(file));
        return file;
    });
}


var uploadContent = function(file, intent) {
    var params = {
        uri: file,
        resolveWithFullResponse: true,
        encoding: null
    };
    return rp(params).then((response) => {
        var content_type = response.headers["content-type"];

        return intent.getClient().uploadContent({
            stream: new Buffer(response.body, "binary"),
            name: file.title,
            type: content_type,
        });
    }).then((response) => {
        var content_uri = JSON.parse(response).content_uri;

        console.log("Media uploaded to " + content_uri);
        return content_uri;
    });

};

var sendMessage = function(message, intent, roomID, token) {
    if (!message.subtype) {
        intent.sendText(roomID, substitutions.slackToMatrix(message.text));
    }
    else if (message.subtype === "me_message") {
        intent.sendMessage(roomID, {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        });
    }
    else if (message.subtype === "file_comment") {
        intent.sendText(roomID, substitutions.slackToMatrix(message.text));
      
    }
    else if (message.subtype === "file_share") {
        if (!message.file) {
            console.log("Ignoring non-text non-image message: " + res);
            return;
        }
        if (message.file.mimetype && message.file.mimetype.indexOf("image/") === 0) {
            // image uploaded in slack. we need to lookup its URL, make it public, and generate the direct public URL
            lookupSharedPublicURL(message.file, token).then((file) => {
                var pub_secret = file.permalink_public.match(/https?:\/\/slack-files.com\/[^-]*-[^-]*-(.*)/);
                var public_file_url = file.permalink_public;
                // try to get direct link to image
                if (pub_secret != undefined && pub_secret.length > 0) {
                    public_file_url = message.file.url_private + "?pub_secret=" + pub_secret[1];
                }
                // upload to media repo; get media repo URL back
                return uploadContent(public_file_url, intent).then((content_uri) => {
                    if(undefined == content_uri) {
                        // no URL returned from media repo; abort
                       return undefined;
                    }
                    var matrixMessage = slackImageToMatrixImage(message.file, content_uri);
                    intent.sendMessage(roomID, matrixMessage);
                });
            }).finally(() => {

            if (message.file.initial_comment) {
                var text = substitutions.slackToMatrix(
                    message.file.initial_comment.comment
                );
                intent.sendText(roomID, text);
            }
            });
        }
    }
    else {
        console.log("Ignoring message with subtype: " + message.subtype);
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
var slackImageToMatrixImage = function(file, url) {
    var message = {
        msgtype: "m.image",
        url: url,
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
    if (false && file.thumb_360) {
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
