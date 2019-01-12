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

SlackEventHandler.prototype.doChannelUserReplacements = async function(msg, token) {
    msg = await this.replaceChannelIdsWithNames(msg, token);
    return await this.replaceUserIdsWithNames(msg, token);
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
SlackEventHandler.prototype.handleMessageEvent = async function (params) {
    var room = this._main.getRoomBySlackChannelId(params.event.channel);
    if (!room) throw new UnknownChannel(params.event.channel);

    if (params.event.subtype === 'bot_message' &&
        (!room.getSlackBotId() || params.event.bot_id === room.getSlackBotId())) {
        return;
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

    // Handle events with attachments like bot messages.
    if (params.event.type === "message" && params.event.attachments) {
        log.warn(params.event.attachments);
        for (var attachment of params.event.attachments) {
            msg.text = attachment.fallback;

            msg = await this.doChannelUserReplacements(msg, token);
            await room.onSlackMessage(msg);
        }
        if (params.event.text != '') {
            msg.text = params.event.text;
        }
        else {
            return;
        }
    }

    // In this method we must standardise the message object so that
    // getGhostForSlackMessage works correctly.
    if (msg.subtype === 'file_comment') {
        msg.user_id = msg.comment.user;
    }
    else if (msg.subtype === "message_changed") {
        msg.user_id = msg.message.user;
        msg.text = msg.message.text;

        // Check if the edit was sent by a bot
        if (msg.message.bot_id !== undefined) {
            // Check the edit wasn't sent by us
            if (msg.message.bot_id === room.getSlackBotId()) {
                return Promise.resolve();
            }
            else {
                msg.user_id = msg.bot_id;
            }
        }
    }
    // We must handle message deleted here because it is not done as the ghost
    // user but as the AS user. (There is no user_id in the message event from
    // which to create a ghost.)
    else if (msg.subtype === "message_deleted") {
        const store = this._main.getEventStore();
        const original_event = await store.getEntryByRemoteId(msg.channel, msg.deleted_ts);
        const bot_client = await this._main.getBotIntent().getClient();
        return await bot_client.redactEvent(original_event.roomId, original_event.eventId);
    }

    if (!token) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        log.warn("no slack token for " + room.getSlackTeamDomain() || room.getSlackChannelId());
        return await room.onSlackMessage(msg);
    }

    if (msg.subtype === "file_share" && msg.file) {
        // we need a user token to be able to enablePublicSharing
        if (room.getSlackUserToken()) {
            // TODO check is_public when matrix supports authenticated media
            // https://github.com/matrix-org/matrix-doc/issues/701
            const file = await this.enablePublicSharing(msg.file, room.getSlackUserToken());
            if (file) {
                msg.file = file;
            }
            const content = await this.fetchFileContent(msg.file, token);
            msg.file._content = content;
        }
    }

    msg = await this.doChannelUserReplacements(msg, token);
    await room.onSlackMessage(msg);
    return;
};

module.exports = SlackEventHandler;
