"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');
var qs = require("querystring");
var Promise = require('bluebird');
var promiseWhile = require("./promiseWhile");

var PRESERVE_KEYS = [
    "team_domain", "team_id",
    "channel_name", "channel_id",
    "user_name", "user_id",
];

var UnknownEvent = function() {};
var UnknownChannel = function(channel) { this.channel = channel; };

/**
 * @constructor
 * @param {Main} main the toplevel bridge instance through which to
 * communicate with matrix.
 */
function SlackEventHandler(main) {
    this._main = main;
}


/**
 * Handles a slack event request.
 *
 * @param {Object} params HTTP body of the event request, as a JSON-parsed dictionary.
 * @param {string} params.team_id The unique identifier for the workspace/team where this event occurred.
 * @param {Object} params.event Slack event object
 * @param {string} params.event.type Slack event type
 * @param {string} params.type type of callback we are receiving. typically event_callback
 *     or url_verification.
 // * @param {string} timestamp Timestamp when message was received, in seconds
 // *     formatted as a float.
 */
SlackEventHandler.prototype.handle = function(params, response) {
    try {
        console.log("Received slack event:", JSON.stringify(params));

        var main = this._main;

        var endTimer = main.startTimer("remote_request_seconds");

        // respond to event url challenges
        if (params.type === 'url_verification') {
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({challenge: params.challenge}));
            response.end();
            return;
        }

        // var room = main.getRoomBySlackChannelId(params.event.channel);

        var result;
        switch (params.event.type) {
            case 'message':
                result = this.handleMessageEvent(params);
                break;
            case 'channel_rename':
                result = this.handleChannelRenameEvent(params);
                break;
            case 'team_domain_change':
                result = this.handleDomainChangeEvent(params);
                break;
            case 'file_comment_added':
                result = Promise.resolve();
                break;
            default:
                result = Promise.reject(new UnknownEvent());
        }

        result
            .then(() => endTimer({outcome: "success"}))
            .catch((e) => {
                    if (e instanceof UnknownChannel) {
                        console.log("Ignoring message from unrecognised slack channel id : %s (%s)",
                            e.channel, params.team_id);
                        main.incCounter("received_messages", {side: "remote"});

                        endTimer({outcome: "dropped"});
                        return;
                    } else if (e instanceof UnknownEvent) {
                        endTimer({outcome: "dropped"});
                    } else {
                        endTimer({outcome: "fail"});
                    }

                    console.log("Failed: ", e);
                }
            );

        response.writeHead(200, {"Content-Type": "application/json"});
        response.end();
    } catch (e) {
        console.log("Oops - SlackEventHandler failed:", e);

        // return 200 so slack doesn't keep sending the event
        response.writeHead(200, {"Content-Type": "text/plain"});
        response.end();
    }
};

SlackEventHandler.prototype.replaceChannelIdsWithNames = function(message, token) {
    var main = this._main;

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
        main.incRemoteCallCounter("channels.info");
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

SlackEventHandler.prototype.replaceUserIdsWithNames = function(message, token) {
    var main = this._main;

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
        main.incRemoteCallCounter("users.info");
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
//SlackEventHandler.prototype.lookupAndSendMessage =
SlackEventHandler.prototype.lookupMessage = function(channelID, timestamp, token) {
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
    this._main.incRemoteCallCounter("channels.history");
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

        if (message.subtype === "file_share" && shouldFetchContent(message.file)) {
            return this.fetchFileContent(message.file, token).then((content) => {
                message.file._content = content;
                return message;
            });
        }
        return message;
    });
}

// Return true if we ought to fetch the content of the given file object
function shouldFetchContent(file) {
    if (!file) return false;
    if (file.mimetype && file.mimetype.indexOf("image/") === 0) return true;
    return false;
}

/**
 * Enables public sharing on the given file object then fetches its content.
 *
 * @param {Object} file A slack 'message.file' data object
 * @param {string} token A slack API token that has 'files:write:user' scope
 * @return {Promise<string>} A Promise of file contents
 */
SlackEventHandler.prototype.fetchFileContent = function(file, token) {
    this._main.incRemoteCallCounter("files.sharedPublicURL");
    return rp({
        method: 'POST',
        form : {
            file: file.id,
            token: token,
        },
        uri: "https://slack.com/api/files.sharedPublicURL",
        json: true
    }).then((response) => {
        if (!response || !response.file || !response.file.permalink_public) {
            console.log("Could not find sharedPublichURL: " + JSON.stringify(response));
            return undefined;
        }

        var pub_secret = file.permalink_public.match(/https?:\/\/slack-files.com\/[^-]*-[^-]*-(.*)/);
        var public_file_url = file.permalink_public;
        // try to get direct link to image
        if (pub_secret != undefined && pub_secret.length > 0) {
            public_file_url = file.url_private + "?pub_secret=" + pub_secret[1];
        }

        return rp({
            uri: public_file_url,
            resolveWithFullResponse: true,
            encoding: null
        });
    }).then((response) => {
        var content = response.body;
        console.log("Successfully fetched file " + file.id +
            " content (" + content.length + " bytes)");
        return content;
    });
}


/**
 *
 * @param room
 * @param params
 */
SlackEventHandler.prototype.handleEvent = function(room, params) {
    var main = this._main;

    // TODO set bot_user_id on room on link. authed_user isn't the correct check
    // TODO(paul): This will reject every bot-posted message, both our own
    //   reflections and other messages from other bot integrations. It would
    //   be nice if we could distinguish the two by somehow learning our own
    //   'bot_id' parameter.
    //     https://github.com/matrix-org/matrix-appservice-slack/issues/29
    // if (params.user_id === "USLACKBOT") {
    if (params.event.user in params.authed_user) {
        return Promise.resolve();
    }

    // Only count received messages that aren't self-reflections
    main.incCounter("received_messages", {side: "remote"});


};

/**
 * Attempts to handle the `team_domain_change` event.
 *
 * @param {Object} params The event request emitted.
 * @param {Object} params.team_id The slack team_id for the event.
 * @param {string} params.event.domain The new team domain.
 */
SlackEventHandler.prototype.handleDomainChangeEvent = function(params) {
    this._main.getRoomsBySlackTeamId(params.team_id).forEach(room => {
        room.updateSlackTeamDomain(params.event.domain);
        if (room.isDirty()) {
            this._main.putRoomToStore(room);
        }
    });
    return Promise.resolve();
};

/**
 * Attempts to handle the `channel_rename` event.
 *
 * @param {Object} params The event request emitted.
 * @param {string} params.event.id The slack channel id
 * @param {string} params.event.name The new name
 */
SlackEventHandler.prototype.handleChannelRenameEvent = function(params) {
    //TODO test me. and do we even need this? doesn't appear to be used anymore
    var room = this._main.getRoomBySlackChannelId(params.event.channel.id);
    if (!room) throw new UnknownChannel(params.event.channel.id);

    var channel_name = room.getSlackTeamDomain() + ".#" + params.name;
    room.updateSlackChannelName(channel_name);
    if (room.isDirty()) {
        this._main.putRoomToStore(room);
    }
    return Promise.resolve();
};

/**
 * Attempts to handle the `message` event.
 *
 * Sends a message to Matrix if it understands enough of the message to do so.
 * Attempts to make the message as native-matrix feeling as it can.
 *
 * @param {Object} params The event request emitted.
 * @param {string} params.event.user Slack user ID of user sending the message.
 // * @param {string} params.user_name Slack user name of the user sending the message.
 * @param {?string} params.event.text Text contents of the message, if a text message.
 * @param {string} params.event.channel The slack channel id
 * @param {string} params.event.ts The unique (per-channel) timestamp
 */
SlackEventHandler.prototype.handleMessageEvent = function(params) {
    var room = this._main.getRoomBySlackChannelId(params.event.channel);
    if (!room) throw new UnknownChannel(params.event.channel);

    if (params.event.subtype === 'bot_message' && params.event.bot_id === room.getSlackBotId()) {
        return Promise.resolve();
    }

    // Only count received messages that aren't self-reflections
    this._main.incCounter("received_messages", {side: "remote"});

    var token = room.getAccessToken();

    var text = params.event.text;
    if (!token) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        console.log("no slack token for " + room.getSlackTeamDomain() || room.getSlackChannelId());

        if (text) {
            return room.onSlackMessage({
                text,
                user_id: params.event.user,
                team_domain: room.getSlackTeamDomain() || room.getSlackTeamId()
            });
        }
        return Promise.resolve();
    }

    if (undefined == text) {
        // TODO(paul): When I started looking at this code there was no lookupAndSendMessage()
        //   I wonder if this code path never gets called...?
        // lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
        return Promise.resolve();
    }

    // TODO update this. I think it only involves file_share messages
    // return this.lookupMessage(params.event.channel, params.event.ts, token).then((msg) => {
    //     console.log('msg ->', msg);
    //     if(undefined == msg) {
    //         msg = params;
    //     }

        // Restore the original parameters, because we've forgotten a lot of
        // them by now
        // "team_domain", "team_id",
        //     "channel_name", "channel_id",
        //     "user_name", "user_id",
        // PRESERVE_KEYS.forEach((k) => msg[k] = params[k]);

    var msg = Object.assign({}, params.event, {
        user_id: params.event.user,
        team_domain: room.getSlackTeamDomain() || room.getSlackTeamId()
    });
    console.log(msg);
    return room.onSlackMessage(msg);
        // return this.replaceChannelIdsWithNames(msg, token);
    // }).then((msg) => {
    //     return this.replaceUserIdsWithNames(msg, token);
    // }).then((msg) => {
        // we can't use .finally here as it does not get the final value, see https://github.com/kriskowal/q/issues/589
        // return room.onSlackMessage(msg);
    // });
};

module.exports = SlackEventHandler;
