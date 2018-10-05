"use strict";

const BaseSlackHandler = require('./BaseSlackHandler');
const Promise = require('bluebird');
const util = require("util");
const log = require("matrix-appservice-bridge").Logging.get("SlackEventHandler");

const UnknownEvent = function () {
};
const UnknownChannel = function (channel) {
    this.channel = channel;
};

/**
 * @constructor
 * @param {Main} main the toplevel bridge instance through which to
 * communicate with matrix.
 */
function SlackEventHandler(main) {
    this._main = main;
}

util.inherits(SlackEventHandler, BaseSlackHandler);

/**
 * Handles a slack event request.
 *
 * @param {Object} params HTTP body of the event request, as a JSON-parsed dictionary.
 * @param {string} params.team_id The unique identifier for the workspace/team where this event occurred.
 * @param {Object} params.event Slack event object
 * @param {string} params.event.type Slack event type
 * @param {string} params.type type of callback we are receiving. typically event_callback
 *     or url_verification.
 */
SlackEventHandler.prototype.handle = function (params, response) {
    try {
        log.debug("Received slack event:", params);

        var main = this._main;

        var endTimer = main.startTimer("remote_request_seconds");

        // respond to event url challenges
        if (params.type === 'url_verification') {
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({challenge: params.challenge}));
            response.end();
            return;
        }

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

        result.then(() => endTimer({outcome: "success"}))
        .catch((e) => {
            if (e instanceof UnknownChannel) {
                log.warn("Ignoring message from unrecognised slack channel id : %s (%s)",
                    e.channel, params.team_id);
                main.incCounter("received_messages", {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (e instanceof UnknownEvent) {
                endTimer({outcome: "dropped"});
            } else {
                endTimer({outcome: "fail"});
            }
            log.error("Failed to handle slack event: ", e);
        });
    } catch (e) {
        log.error("SlackEventHandler.handle failed:", e);
    }

    // return 200 so slack doesn't keep sending the event
    response.writeHead(200, {"Content-Type": "text/plain"});
    response.end();

};

/**
 * Attempts to handle the `team_domain_change` event.
 *
 * @param {Object} params The event request emitted.
 * @param {Object} params.team_id The slack team_id for the event.
 * @param {string} params.event.domain The new team domain.
 */
SlackEventHandler.prototype.handleDomainChangeEvent = function (params) {
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
SlackEventHandler.prototype.handleChannelRenameEvent = function (params) {
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
 * @param {?string} params.event.text Text contents of the message, if a text message.
 * @param {string} params.event.channel The slack channel id
 * @param {string} params.event.ts The unique (per-channel) timestamp
 */
SlackEventHandler.prototype.handleMessageEvent = function (params) {
    var room = this._main.getRoomBySlackChannelId(params.event.channel);
    if (!room) throw new UnknownChannel(params.event.channel);

    if (params.event.subtype === 'bot_message' &&
        (!room.getSlackBotId() || params.event.bot_id === room.getSlackBotId())) {
        return Promise.resolve();
    }

    // Only count received messages that aren't self-reflections
    this._main.incCounter("received_messages", {side: "remote"});

    var token = room.getAccessToken();

    var msg = Object.assign({}, params.event, {
        user_id: params.event.user || params.event.bot_id,
        team_domain: room.getSlackTeamDomain() || room.getSlackTeamId(),
        team_id: params.team_id,
        channel_id: params.event.channel
    });

    const processMsg = msg.text || msg.subtype === 'message_deleted' || msg.files != undefined || msg.subtype === 'message_changed';

    if (msg.subtype === 'file_comment') {
        msg.user_id = msg.comment.user;
    }
    // Make a message_changed look a little more like a normal message.
    else if (msg.subtype === "message_changed") {
        msg.user_id = msg.message.user;
        msg.text = msg.message.text;
    }

    if (!token) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        log.warn("no slack token for " + room.getSlackTeamDomain() || room.getSlackChannelId());

        return (processMsg) ? room.onSlackMessage(msg) : Promise.resolve();
    }

    if (!processMsg) {
        // TODO(paul): When I started looking at this code there was no lookupAndSendMessage()
        //   I wonder if this code path never gets called...?
        // lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
        log.warn("Did not understand event: ", JSON.stringify(message));
        return Promise.resolve();
    }

    var result;
    if (msg.subtype === "file_share" && msg.file) {
        // TODO check is_public when matrix supports authenticated media https://github.com/matrix-org/matrix-doc/issues/701
        // we need a user token to be able to enablePublicSharing
        if (room.getSlackUserToken()) {
            result = this.enablePublicSharing(msg.file, room.getSlackUserToken())
                .then((file) => {
                    if (file) {
                        msg.file = file;
                    }

                    return this.fetchFileContent(msg.file, token)
                        .then((content) => {
                            msg.file._content = content;
                        });
                })
        }
    } else {
        result = Promise.resolve();
    }

    return result.then(() => msg)
        .then((msg) => this.replaceChannelIdsWithNames(msg, token))
        .then((msg) => this.replaceUserIdsWithNames(msg, token))
        .then((msg) => room.onSlackMessage(msg));
};

module.exports = SlackEventHandler;
