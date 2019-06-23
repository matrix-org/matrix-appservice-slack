"use strict";

const Promise = require('bluebird');

const url = require('url');
const substitutions = require("./substitutions");
const rp = require('request-promise');
const log = require("matrix-appservice-bridge").Logging.get("BridgedRoom");
const BridgeLib = require("matrix-appservice-bridge");
const StoreEvent = BridgeLib.StoreEvent;

function BridgedRoom(main, opts) {
    this._main = main;

    if (!opts.inbound_id) {
        throw new Error("BridgedRoom requires an inbound ID");
    }
    if (!opts.matrix_room_id) {
        throw new Error("BridgedRoom requires an Matrix Room ID");
    }

    this._matrix_room_id = opts.matrix_room_id;
    this._inbound_id = opts.inbound_id;
    this._slack_channel_name = opts.slack_channel_name;
    this._slack_channel_id = opts.slack_channel_id;
    this._slack_webhook_uri = opts.slack_webhook_uri;
    this._slack_bot_token = opts.slack_bot_token;
    this._slack_user_token = opts.slack_user_token;
    this._slack_team_domain = opts.slack_team_domain;
    this._slack_team_id = opts.slack_team_id;
    this._slack_user_id = opts.slack_user_id;
    this._slack_bot_id =  opts.slack_bot_id;
    this._access_token = opts.access_token;
    this._access_scopes = opts.access_scopes;

    this._slackAtime = null;  // last activity time in epoch seconds
    this._matrixAtime = null;

    this._dirty = true;
};

BridgedRoom.prototype.getStatus = function() {
    if (!this._slack_webhook_uri && !this._slack_bot_token) {
        return "pending-params";
    }
    if (!this._slack_channel_name) {
        return "pending-name";
    }
    if (!this._access_token && !this._slack_bot_token) {
        return "ready-no-token";
    }
    return "ready";
}

// Returns true if this instance has changed from the version last read/written
// to the RoomStore.
BridgedRoom.prototype.isDirty = function() {
    return this._dirty;
};

BridgedRoom.prototype.getInboundId = function() {
    return this._inbound_id;
};

BridgedRoom.prototype.getSlackChannelId = function() {
    return this._slack_channel_id;
};

BridgedRoom.prototype.getSlackChannelName = function() {
    return this._slack_channel_name;
};

BridgedRoom.prototype.getSlackWebhookUri = function() {
    return this._slack_webhook_uri;
};

BridgedRoom.prototype.getAccessToken = function() {
    return this._access_token || this._slack_bot_token;
};

BridgedRoom.prototype.getMatrixRoomId = function() {
    return this._matrix_room_id;
};

BridgedRoom.prototype.getSlackTeamDomain = function() {
    return this._slack_team_domain;
};

BridgedRoom.prototype.getSlackTeamId = function() {
    return this._slack_team_id;
};

BridgedRoom.prototype.getSlackBotId = function() {
    return this._slack_bot_id;
};

BridgedRoom.prototype.getSlackUserToken = function() {
    return this._slack_user_token;
};

BridgedRoom.prototype.updateInboundId = function(inbound_id) {
    if (this._inbound_id !== inbound_id) this._dirty = true;
    this._inbound_id = inbound_id;
};

BridgedRoom.prototype.updateSlackChannelId = function(channel_id) {
    if (this._slack_channel_id !== channel_id) this._dirty = true;
    this._slack_channel_id = channel_id;
};

BridgedRoom.prototype.updateSlackChannelName = function(channel_name) {
    if (this._slack_channel_name !== channel_name) this._dirty = true;
    this._slack_channel_name = channel_name;
};

BridgedRoom.prototype.updateSlackWebhookUri = function(slack_webhook_uri) {
    if (this._slack_webhook_uri !== slack_webhook_uri) this._dirty = true;
    this._slack_webhook_uri = slack_webhook_uri;
};

BridgedRoom.prototype.updateSlackBotToken = function(slack_bot_token) {
    if (this._slack_bot_token !== slack_bot_token) this._dirty = true;
    this._slack_bot_token = slack_bot_token;
};

BridgedRoom.prototype.updateSlackUserToken = function(slack_user_token) {
    if (this._slack_user_token !== slack_user_token) this._dirty = true;
    this._slack_user_token = slack_user_token;
};

BridgedRoom.prototype.updateSlackTeamDomain = function(domain) {
    if (this._slack_team_domain !== domain) this._dirty = true;
    this._slack_team_domain = domain;
};

BridgedRoom.prototype.updateAccessToken = function(token, scopes) {
    log.info('updateAccessToken ->', token, scopes);
    if (this._access_token === token &&
        this._access_scopes.sort().join(",") === scopes.sort().join(",")) return;

    this._access_token = token;
    this._access_scopes = scopes;
    this._dirty = true;
};

BridgedRoom.fromEntry = function(main, entry) {
    var opts = {
        inbound_id: entry.remote_id,
        matrix_room_id: entry.matrix_id,
        slack_channel_id: entry.remote.id,
        slack_channel_name: entry.remote.name,
        slack_webhook_uri: entry.remote.webhook_uri,
        slack_bot_token: entry.remote.slack_bot_token,
        slack_user_token: entry.remote.slack_user_token,
        slack_team_domain: entry.remote.slack_team_domain,
        slack_team_id: entry.remote.slack_team_id,
        slack_user_id: entry.remote.slack_user_id,
        slack_bot_id: entry.remote.slack_bot_id,
        access_token: entry.remote.access_token,
        access_scopes: entry.remote.access_scopes,
    };

    return new BridgedRoom(main, opts);
};

// Returns data to write to the RoomStore
// As a side-effect will also clear the isDirty() flag
BridgedRoom.prototype.toEntry = function() {
    var entry = {
        remote: {
            id: this._slack_channel_id,
            name: this._slack_channel_name,
            webhook_uri: this._slack_webhook_uri,
            slack_bot_token: this._slack_bot_token,
            slack_user_token: this._slack_user_token,
            slack_team_domain: this._slack_team_domain,
            slack_team_id: this._slack_team_id,
            slack_user_id: this._slack_user_id,
            slack_bot_id: this._slack_bot_id,
            access_token: this._access_token,
            access_scopes: this._access_scopes,
        },
    };

    entry.id = "INTEG-" + this._inbound_id;
    entry.matrix_id = this._matrix_room_id;
    entry.remote_id = this._inbound_id;

    this._dirty = false;
    return entry;
};

BridgedRoom.prototype.onMatrixRedaction = async function(message) {
    if (!this._slack_bot_token) return;

    const eventStore = this._main.getEventStore();
    const event = await eventStore.getEntryByMatrixId(message.room_id, message.redacts);

    // If we don't get an event then exit
    if (event === null) {
        log.debug("Could not find event '${message.redacts}' in room '${message.room_id}' to delete.");
        return;
    }

    const body = {channel: this._slack_channel_id,
                  ts: event.remoteEventId,
                  as_user: false};

    const sendMessageParams = {
        method: "POST",
        json: true,
        uri: "https://slack.com/api/chat.delete",
        body: body,
    };

    if (this._slack_bot_token) {
        sendMessageParams.headers = {
            Authorization: 'Bearer ' + this._slack_bot_token
        };
    }

    return await rp(sendMessageParams);
};

BridgedRoom.prototype.onMatrixEdit = async function(message) {
    if (!this._slack_webhook_uri && !this._slack_bot_token) return Promise.resolve();

    const eventStore = this._main.getEventStore();
    const event = await eventStore.getEntryByMatrixId(message.room_id, message.content['m.relates_to'].event_id);

    // re-write the message so the matrixToSlack converter works as expected.
    const new_message = JSON.parse(JSON.stringify(message));
    new_message.content = message.content['m.new_content'];

    const body = await substitutions.matrixToSlack(new_message, this._main);

    const sendMessageParams = {
        method: "POST",
        json: true,
        uri: "https://slack.com/api/chat.update",
        body: body,
    };
    sendMessageParams.body.ts = event.remoteEventId;
    sendMessageParams.body.as_user = false;
    sendMessageParams.body.channel = this._slack_channel_id;

    if (this._slack_bot_token) {
        sendMessageParams.headers = {
            Authorization: 'Bearer ' + this._slack_bot_token
        };
    }
    const res = await rp(sendMessageParams);
    this._main.incCounter("sent_messages", {side: "remote"});
    if (!res || !res.ok) {
        log.error("HTTP Error: ", res);
    }
    else {
        // Add this event to the event store
        const event = new StoreEvent(message.room_id, message.event_id, this._slack_channel_id, res.ts);
        const store = this._main.getEventStore();
        store.upsertEvent(event);
    }
    return res;

};

/*
  Strip out reply fallbacks. Borrowed from
  https://github.com/turt2live/matrix-js-bot-sdk/blob/master/src/preprocessors/RichRepliesPreprocessor.ts
*/
BridgedRoom.prototype.stripMatrixReplyFallback = function(event) {
    let realHtml = event["content"]["formatted_body"];
    let realText = event["content"]["body"];

    if (event["content"]["format"] === "org.matrix.custom.html" && event["content"]["formatted_body"]) {
        const formattedBody = event["content"]["formatted_body"];
        if (formattedBody.startsWith("<mx-reply>") && formattedBody.indexOf("</mx-reply>") !== -1) {
            const parts = formattedBody.split("</mx-reply>");
            realHtml = parts[1];

            event["content"]["formatted_body"] = realHtml.trim();
        }
    }

    let processedFallback = false;
    const body = event["content"]["body"] || "";
    for (const line of body.split("\n")) {
        if (line.startsWith("> ") && !processedFallback) {
            continue;
        } else if (!processedFallback) {
            realText = line;
            processedFallback = true;
        } else {
            realText += line + "\n";
        }
    }

    event["content"]["body"] = realText.trim();
    return event;
};

/*
  Given an event which is in reply to something else return the event ID of the
  top most event in the reply chain, i.e. the one without a relates to.
*/
BridgedRoom.prototype.findParentReply = async function(message) {
    // Extract the referenced event
    if (!message["content"]) return message.event_id;
    if (!message["content"]["m.relates_to"]) return message.event_id;
    if (!message["content"]["m.relates_to"]["m.in_reply_to"]) return message.event_id;
    const parentEventId = message["content"]["m.relates_to"]["m.in_reply_to"]["event_id"];
    if (!parentEventId) return message.event_id;

    // Get the previous event
    const intent = this._main.getBotIntent();
    let nextEvent = await intent.getClient().fetchRoomEvent(message.room_id, parentEventId);

    return this.findParentReply(nextEvent);
};

BridgedRoom.prototype.onMatrixMessage = async function(message) {
    if (!this._slack_webhook_uri && !this._slack_bot_token) return;
    const store = this._main.getEventStore();

    const user = await this._main.getOrCreateMatrixUser(message.user_id);

    message = this.stripMatrixReplyFallback(message);
    const body = await substitutions.matrixToSlack(message, this._main);
    const uri = (this._slack_bot_token) ? "https://slack.com/api/chat.postMessage" : this._slack_webhook_uri;

    const sendMessageParams = {
        method: "POST",
        json: true,
        uri: uri,
        body: body,
    };
    if (this._slack_bot_token) {
        sendMessageParams.headers = {
            Authorization: 'Bearer ' + this._slack_bot_token
        };
        // See https://api.slack.com/methods/chat.postMessage#authorship
        // Setting as_user to false means "When the as_user parameter is set to
        // false, messages are posted as "bot_messages", with message authorship
        // attributed to the user name"
        sendMessageParams.body.as_user = false;
        sendMessageParams.body.channel = this._slack_channel_id;
    }

    // Set the username which is used because as_user is false.
    sendMessageParams.body.username = user.getDisplaynameForRoom(message.room_id);

    const reply = await this.findParentReply(message);
    if (reply !== message.event_id) {
        // We have a reply
        const parentStoreEvent = await store.getEntryByMatrixId(message.room_id, reply);
        sendMessageParams.body.thread_ts = parentStoreEvent.remoteEventId;
    }

    const avatar_url = user.getAvatarUrlForRoom(message.room_id);

    if (avatar_url && avatar_url.indexOf("mxc://") === 0) {
        sendMessageParams.body.icon_url = this._main.getUrlForMxc(avatar_url);
    }

    user.bumpATime();
    this._matrixAtime = Date.now() / 1000;

    const res = await rp(sendMessageParams);
    this._main.incCounter("sent_messages", {side: "remote"});
    if (!res || !res.ok) {
        log.error("HTTP Error: ", res);
    }
    else {
        // Add this event to the event store
        const event = new StoreEvent(message.room_id, message.event_id, this._slack_channel_id, res.ts);
        store.upsertEvent(event);
    }
    return res;
};

BridgedRoom.prototype.onSlackMessage = async function(message) {
    try {
        const ghost = await this._main.getGhostForSlackMessage(message);
        await ghost.update(message, this);
        return await this._handleSlackMessage(message, ghost);
    } catch(err) {
        log.error("Failed to process event");
        log.error(err);
    }
};


BridgedRoom.prototype._handleSlackMessage = async function(message, ghost) {
    const roomID = this.getMatrixRoomId();
    const eventTS = message.event_ts;
    const slackRoomID = this.getSlackChannelId();
    const eventStore = this._main.getEventStore();

    ghost.bumpATime();
    this._slackAtime = Date.now() / 1000;

    var subtype = message.subtype;

    // Transform the text if it is present.
    if (message.text) {
        message.text = substitutions.slackToMatrix(message.text,
            subtype === "file_comment" ? message.file : undefined);
    }

    if (message.thread_ts !== undefined) {
        // Get parent event
        const parentEvent = await eventStore.getEntryByRemoteId(slackRoomID, message.thread_ts);
        let replyToTS = "";
        // Add this event to the list of events in this thread
        if (parentEvent._extras.slackThreadMessages === undefined) {
            parentEvent._extras.slackThreadMessages = [];
        }
        replyToTS = parentEvent._extras.slackThreadMessages.slice(-1)[0] || message.thread_ts;
        parentEvent._extras.slackThreadMessages.push(message.ts);
        await eventStore.upsertEvent(parentEvent);

        // Get event to reply to
        const replyToEvent = await eventStore.getEntryByRemoteId(slackRoomID, replyToTS);
        const m_in_reply_to = {"m.in_reply_to": {event_id: replyToEvent.eventId}};
        const matrixContent = {msgtype: "m.text",
                               // TODO: Probably should add the reply fallback here.
                               body: message.text,
                               "m.relates_to": m_in_reply_to};

        return ghost.sendMessage(roomID, matrixContent, slackRoomID, eventTS);
    }

    // If we are only handling text, send the text.
    if ([undefined, "bot_message", "file_comment"].includes(subtype)) {
        return ghost.sendText(roomID, message.text, slackRoomID, eventTS);
    }
    // emotes
    else if (subtype === "me_message") {
        const message = {
            msgtype: "m.emote",
            body: message.text
        };
        return ghost.sendMessage(roomID, message, slackRoomID, eventTS);
    }
    // edits
    else if (subtype === "message_changed") {
        const previous_message = substitutions.slackToMatrix(message.previous_message.text);
        // We use message.text here rather than the proper message.message.text
        // as we have added message.text ourselves and then transformed it.
        const new_message = substitutions.slackToMatrix(message.text);

        // The substitutions might make the messages the same
        if (previous_message === new_message) {
            log.debug("Ignoring edit message because messages are the same post-substitutions.");
            return;
        }

        const edits = substitutions.makeDiff(previous_message, new_message);

        const outtext = "(edited) " +
            edits.before + edits.prev + edits.after + " => " +
            edits.before + edits.curr + edits.after;

        const prev   = substitutions.htmlEscape(edits.prev);
        const curr   = substitutions.htmlEscape(edits.curr);
        const before = substitutions.htmlEscape(edits.before);
        const after  = substitutions.htmlEscape(edits.after);

        const formatted = `<i>(edited)</i> ${before} <font color="red"> ${prev} </font> ${after} =&gt; ${before} <font color="green"> ${curr} </font> ${after}`;

        const prev_event = await eventStore.getEntryByRemoteId(slackRoomID, message.previous_message.ts);
        const matrixcontent = {
            body: outtext,
            msgtype: "m.text",
            formatted_body: formatted,
            format: "org.matrix.custom.html",
            "m.relates_to": {
                rel_type: "m.replace",
                event_id: prev_event.eventId},
            "m.new_content": {
                msgtype: "m.text",
                // TODO: Add formatted body here
                body: new_message}
        };

        return ghost.sendMessage(roomID, matrixcontent, slackRoomID, eventTS);
    }
    else if (message.files != undefined) {
        for (var i = 0; i < message.files.length; i++) {
            const file = message.files[i];
            if (file.mode === "snippet") {
                return rp({
                    uri: file.url_private,
                    headers: {
                        Authorization: `Bearer ${this._slack_bot_token}`,
                    }
                }).then((htmlString) => {
                    let htmlCode = "";
                    let code = '```';
                    code += '\n';
                    code += htmlString;
                    code += '\n';
                    code += '```';
                    if (file.filetype) {
                        htmlCode = '<pre><code class="language-' + file.filetype + '">';
                    }
                    else {
                        htmlCode = '<pre><code>';
                    }
                    htmlCode += substitutions.htmlEscape(htmlString);
                    htmlCode += '</code></pre>';

                    const content = {
                        body: code,
                        msgtype: "m.text",
                        formatted_body: htmlCode,
                        format: "org.matrix.custom.html"
                    };
                    return ghost.sendMessage(roomID, content, slackRoomID, eventTS);
                }).then(() => {
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(roomID, message.text, slackRoomID, eventTS);
                    }
                }).catch(function (err) {
                    log.error("Unable to download snippet", err);
                    throw err;
                });
            }
            // A file which is not a snippet
            else {
                // We also need to upload the thumbnail
                let thumbnail_promise = Promise.resolve();
                // Slack ain't a believer in consistency.
                const thumb_uri = file.thumb_video || file.thumb_360;
                if (thumb_uri && file.filetype) {
                    thumbnail_promise = ghost.uploadContentFromURI(
                        {
                            title: `${file.name}_thumb.${file.filetype}`,
                            mimetype: file.mimetype,
                        },
                        thumb_uri,
                        this._slack_bot_token
                    );
                }
                let content_uri = "";
                return ghost.uploadContentFromURI(file, file.url_private, this._slack_bot_token)
                .then((file_content_uri) => {
                    content_uri = file_content_uri;
                    return thumbnail_promise;
                }).then((thumb_content_uri) => {
                    return ghost.sendMessage(
                        roomID,
                        slackFileToMatrixMessage(file, content_uri, thumb_content_uri),
                        slackRoomID,
                        eventTS
                    );
                }).then(() => {
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(roomID, message.text, slackRoomID, eventTS);
                    }
                });
            }
        }
    }
    else {
        log.warn("Ignoring message with subtype: " + subtype);
    }
};

BridgedRoom.prototype.leaveGhosts = function(ghosts) {
    var roomID = this.getMatrixRoomId();
    var main = this._main;

    return Promise.each(ghosts,
        (ghost) => {
            var intent = main._bridge.getIntent(ghost);
            return intent.leave(roomID);
        }
    )
};

/**
 * Converts a slack image attachment to a matrix image event.
 *
 * @param {Object} file The slack image attachment file object.
 * @param {?integer} file.size size of the file in bytes.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {?integer} file.original_w width of the file if an image, in pixels.
 * @param {?integer} file.original_h height of the file if an image, in pixels.
 * @param {?string} file.thumb_360 URL of a 360 pixel wide thumbnail of the
 *     file, if an image.
 * @param {?integer} file.thumb_360_w width of the thumbnail of the 360 pixel
 *     wide thumbnail of the file, if an image.
 * @param {?integer} file.thumb_360_h height of the thumbnail of the 36 pixel
 *     wide thumbnail of the file, if an image.
 * @param {string} url The matrix file mxc.
 * @param {?string} thumbnail_url The matrix thumbnail mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/#m-image
 */
const slackImageToMatrixImage = function(file, url, thumbnail_url) {
    var message = {
        msgtype: "m.image",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
    };

    if (file.original_w) {
        message.info.w = file.original_w;
    }

    if (file.original_h) {
        message.info.h = file.original_h;
    }

    if (thumbnail_url) {
        message.thumbnail_url = thumbnail_url;
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

/**
 * Converts a slack video attachment to a matrix video event.
 *
 * @param {Object} file The slack video attachment file object.
 * @param {?integer} file.size size of the file in bytes.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {?integer} file.original_w width of the file if an image, in pixels.
 * @param {?integer} file.original_h height of the file if an image, in pixels.
 * @param {string} url The matrix file mxc.
 * @param {?string} thumbnail_url The matrix thumbnail mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/client_server/r0.4.0.html#m-video
 */
const slackImageToMatrixVideo = function(file, url, thumbnail_url) {
    var message = {
        msgtype: "m.video",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
    };

    if (file.original_w) {
        message.info.w = file.original_w;
    }

    if (file.original_h) {
        message.info.h = file.original_h;
    }

    if (thumbnail_url) {
        message.thumbnail_url = thumbnail_url;
        // Slack don't tell us the thumbnail size for videos. Boo
    }

    return message;
};

/**
 * Converts a slack audio attachment to a matrix audio event.
 *
 * @param {Object} file The slack audio attachment file object.
 * @param {?integer} file.size size of the file in bytes.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {string} url The matrix file mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/client_server/r0.4.0.html#m-audio
 */
const slackImageToMatrixAudio = function(file, url) {
    return {
        msgtype: "m.audio",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
    };
};
/**
 * Converts a slack file upload to a matrix file upload event.
 *
 * @param {Object} file The slack file object.
 * @param {string} url The matrix file mxc.
 * @param {?string} thumbnail_url The matrix thumbnail mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/#m-file
 */
const slackFileToMatrixMessage = function(file, url, thumbnail_url) {
    if (file.mimetype) {
        if (file.mimetype.startsWith("image/")) {
            return slackImageToMatrixImage(file, url, thumbnail_url);
        } else if (file.mimetype.startsWith("video/")) {
            return slackImageToMatrixVideo(file, url, thumbnail_url);
        } else if (file.mimetype.startsWith("audio/")) {
            return slackImageToMatrixAudio(file, url);
        }
    }

    const message = {
        msgtype: "m.file",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
    };
    return message;
};

BridgedRoom.prototype.getRemoteATime = function() {
    return this._slackAtime;
};

BridgedRoom.prototype.getMatrixATime = function() {
    return this._matrixAtime;
};

BridgedRoom.prototype.refreshTeamInfo = function() {
    if (!this._slack_bot_token) return Promise.resolve();

    return rp({
        uri: 'https://slack.com/api/team.info',
        qs: {
            token: this._slack_bot_token
        },
        json: true,
    }).then((response) => {
        if (!response.team) return;

        if (this._slack_team_domain !== response.team.domain) {
            this._slack_team_domain = response.team.domain;
            this._dirty = true;
        }

        if (this._slack_team_id !== response.team.id) {
            this._slack_team_id = response.team.id;
            this._dirty = true;
        }
    });
};

BridgedRoom.prototype.refreshUserInfo = function() {
    if (!this._slack_bot_token) return Promise.resolve();

    return rp({
        uri: 'https://slack.com/api/auth.test',
        qs: {
            token: this._slack_bot_token
        },
        json: true,
    }).then((response) => {
        log.debug("auth.test res:", response);
        if (!response.user_id) return;

        if (this._slack_user_id !== response.user_id) {
            this._slack_user_id = response.user_id;
            this._dirty = true;
        }

        return rp({
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: this._slack_bot_token,
                user: response.user_id,
            },
            json: true,
        });
    }).then((response) => {
        if (!response.user || !response.user.profile) return;

        if (this._slack_bot_id !== response.user.profile.bot_id) {
            this._slack_bot_id = response.user.profile.bot_id;
            this._dirty = true;
        }
    });
};

module.exports = BridgedRoom;
