"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rp = require("request-promise-native");
const matrix_appservice_bridge_1 = require("matrix-appservice-bridge");
const substitutions_1 = require("./substitutions");
const emoji = require("node-emoji");
const log = matrix_appservice_bridge_1.Logging.get("BridgedRoom");
class BridgedRoom {
    constructor(main, opts) {
        this.main = main;
        if (!opts.inbound_id) {
            throw new Error("BridgedRoom requires an inbound ID");
        }
        if (!opts.matrix_room_id) {
            throw new Error("BridgedRoom requires an Matrix Room ID");
        }
        // NOTE: Wow f**k me that's a lot of opts.
        this.matrixRoomId = opts.matrix_room_id;
        this.inboundId = opts.inbound_id;
        this.slackChannelName = opts.slack_channel_name;
        this.slackChannelId = opts.slack_channel_id;
        this.slackWebhookUri = opts.slack_webhook_uri;
        this.slackBotToken = opts.slack_bot_token;
        this.slackUserToken = opts.slack_user_token;
        this.slackTeamDomain = opts.slack_team_domain;
        this.slackTeamId = opts.slack_team_id;
        this.slackUserId = opts.slack_user_id;
        this.slackBotId = opts.slack_bot_id;
        this.accessToken = opts.access_token;
        this.accessScopes = opts.access_scopes;
        this.dirty = true;
    }
    static fromEntry(main, entry) {
        return new BridgedRoom(main, {
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
        });
    }
    getStatus() {
        if (!this.slackWebhookUri && !this.slackBotToken) {
            return "pending-params";
        }
        if (!this.slackChannelName) {
            return "pending-name";
        }
        if (!this.accessToken && !this.slackBotToken) {
            return "ready-no-token";
        }
        return "ready";
    }
    get isDirty() {
        return this.dirty;
    }
    get InboundId() {
        return this.inboundId;
    }
    setValue(key, value) {
        const sneakyThis = this;
        if (sneakyThis[key] === value) {
            return;
        }
        sneakyThis[key] = value;
        this.dirty = true;
    }
    set InboundId(value) {
        this.setValue("inboundId", value);
    }
    get SlackChannelId() {
        return this.slackChannelId;
    }
    set SlackChannelId(value) {
        this.setValue("slackChannelId", value);
    }
    get SlackChannelName() {
        return this.slackChannelName;
    }
    set SlackChannelName(value) {
        this.setValue("slackChannelName", value);
    }
    get SlackWebhookUri() {
        return this.slackWebhookUri;
    }
    set SlackWebhookUri(value) {
        this.setValue("slackWebhookUri", value);
    }
    get AccessToken() {
        return this.accessToken || this.slackBotToken;
    }
    get SlackBotToken() {
        return this.slackBotToken;
    }
    set SlackBotToken(value) {
        this.setValue("slackBotToken", value);
    }
    get MatrixRoomId() {
        return this.matrixRoomId;
    }
    get SlackTeamDomain() {
        return this.slackTeamDomain;
    }
    set SlackTeamDomain(value) {
        this.setValue("slackTeamDomain", value);
    }
    get SlackTeamId() {
        return this.slackTeamId;
    }
    get SlackBotId() {
        return this.slackBotId;
    }
    get SlackUserToken() {
        return this.slackUserToken;
    }
    set SlackUserToken(value) {
        this.setValue("slackUserToken", value);
    }
    updateAccessToken(token, scopes) {
        log.info('updateAccessToken ->', token, scopes);
        const sameScopes = this.accessScopes && [...this.accessScopes].sort().join(",") === [...scopes].sort().join(",");
        if (this.accessToken === token && sameScopes) {
            return;
        }
        this.accessToken = token;
        this.accessScopes = scopes;
        this.dirty = true;
    }
    /**
     * Returns data to write to the RoomStore
     * As a side-effect will also clear the isDirty() flag
     */
    toEntry() {
        const entry = {
            remote: {
                id: this.slackChannelId,
                name: this.slackChannelName,
                webhook_uri: this.slackWebhookUri,
                slack_bot_token: this.slackBotToken,
                slack_user_token: this.slackUserToken,
                slack_team_domain: this.slackTeamDomain,
                slack_team_id: this.slackTeamId,
                slack_user_id: this.slackUserId,
                slack_bot_id: this.slackBotId,
                access_token: this.accessToken,
                access_scopes: this.accessScopes ? [...this.accessScopes] : [],
            },
            id: `INTEG-${this.inboundId}`,
            matrix_id: this.matrixRoomId,
            remote_id: this.inboundId,
        };
        this.dirty = false;
        return entry;
    }
    async onMatrixReaction(message) {
        if (!this.SlackBotToken)
            return;
        const relates_to = message.content['m.relates_to'];
        const eventStore = this.main.eventStore;
        const event = await eventStore.getEntryByMatrixId(message.room_id, relates_to.event_id);
        // If we don't get an event then exit
        if (event === null) {
            log.debug("Could not find event to react to.");
            return;
        }
        // Convert the unicode emoji into a slack emote name
        let emoji_key_name;
        let emoji_item = emoji.find(relates_to.key);
        if (emoji_item !== undefined) {
            emoji_key_name = emoji_item.key;
        }
        else {
            emoji_key_name = relates_to.key;
            // Strip the colons
            if (emoji_key_name.startsWith(":") && emoji_key_name.endsWith(":")) {
                emoji_key_name = emoji_key_name.substring(1, emoji_key_name.length - 1);
            }
        }
        // TODO: This only works once from matrix as we are sending the event as the
        // bot user.
        const body = { channel: this.slackChannelId,
            timestamp: event.remoteEventId,
            name: emoji_key_name,
            as_user: false };
        const sendMessageParams = {
            method: "POST",
            json: true,
            uri: "https://slack.com/api/reactions.add",
            body: body,
            headers: {}
        };
        if (this.slackBotToken) {
            sendMessageParams.headers = {
                Authorization: 'Bearer ' + this.slackBotToken
            };
        }
        const res = await rp(sendMessageParams);
        if (!res || !res.ok) {
            log.error("HTTP Error: ", res);
        }
        else {
            // TODO: Add this event to the event store
            // Unfortunately reactions.add does not return the ts of the reactions event.
            // So we can't store it in the event store
        }
        return res;
    }
    async onMatrixRedaction(message) {
        if (!this.slackBotToken)
            return;
        const event = await this.main.eventStore.getEntryByMatrixId(message.room_id, message.redacts);
        // If we don't get an event then exit
        if (event === null) {
            log.debug("Could not find event '${message.redacts}' in room '${message.room_id}' to delete.");
            return;
        }
        const body = {
            channel: this.slackChannelId,
            ts: event.remoteEventId,
            as_user: false
        };
        const sendMessageParams = {
            method: "POST",
            json: true,
            uri: "https://slack.com/api/chat.delete",
            body: body,
            headers: {},
        };
        if (this.slackBotToken) {
            sendMessageParams.headers = {
                Authorization: `Bearer ${this.slackBotToken}`,
            };
        }
        const res = await rp(sendMessageParams);
        if (!res || !res.ok) {
            log.error("HTTP Error: ", res);
        }
        return res;
    }
    async onMatrixEdit(message) {
        if (!this.slackWebhookUri && !this.slackBotToken)
            return;
        const event = await this.main.eventStore.getEntryByMatrixId(message.room_id, message.content['m.relates_to'].event_id);
        // re-write the message so the matrixToSlack converter works as expected.
        const new_message = JSON.parse(JSON.stringify(message));
        new_message.content = message.content['m.new_content'];
        const body = await substitutions_1.default.matrixToSlack(new_message, this.main, this.SlackTeamId);
        const sendMessageParams = {
            method: "POST",
            json: true,
            uri: "https://slack.com/api/chat.update",
            body: body,
            headers: {},
        };
        sendMessageParams.body.ts = event.remoteEventId;
        sendMessageParams.body.as_user = false;
        sendMessageParams.body.channel = this.slackChannelId;
        if (this.slackBotToken) {
            sendMessageParams.headers = {
                Authorization: `Bearer ${this.slackBotToken}`
            };
        }
        const res = await rp(sendMessageParams);
        this.main.incCounter("sent_messages", { side: "remote" });
        if (!res || !res.ok) {
            log.error("HTTP Error: ", res);
        }
        else {
            // Add this event to the event store
            const event = new matrix_appservice_bridge_1.StoreEvent(message.room_id, message.event_id, this.slackChannelId, res.ts);
            this.main.eventStore.upsertEvent(event);
        }
        return res;
    }
    /*
      Strip out reply fallbacks. Borrowed from
      https://github.com/turt2live/matrix-js-bot-sdk/blob/master/src/preprocessors/RichRepliesPreprocessor.ts
    */
    async stripMatrixReplyFallback(event) {
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
            }
            else if (!processedFallback) {
                realText = line;
                processedFallback = true;
            }
            else {
                realText += line + "\n";
            }
        }
        event["content"]["body"] = realText.trim();
        return event;
    }
    ;
    /*
    Given an event which is in reply to something else return the event ID of the
    top most event in the reply chain, i.e. the one without a relates to.
    */
    async findParentReply(message) {
        // Extract the referenced event
        if (!message["content"])
            return message.event_id;
        if (!message["content"]["m.relates_to"])
            return message.event_id;
        if (!message["content"]["m.relates_to"]["m.in_reply_to"])
            return message.event_id;
        const parentEventId = message["content"]["m.relates_to"]["m.in_reply_to"]["event_id"];
        if (!parentEventId)
            return message.event_id;
        // Get the previous event
        const intent = this.main.botIntent;
        const nextEvent = await intent.getClient().fetchRoomEvent(message.room_id, parentEventId);
        return this.findParentReply(nextEvent);
    }
    ;
    async onMatrixMessage(message) {
        if (!this.slackWebhookUri && !this.slackBotToken)
            return;
        const user = await this.main.getOrCreateMatrixUser(message.user_id);
        message = this.stripMatrixReplyFallback(message);
        const body = await substitutions_1.default.matrixToSlack(message, this.main, this.SlackTeamId);
        const uri = (this.slackBotToken) ? "https://slack.com/api/chat.postMessage" : this.slackWebhookUri;
        const sendMessageParams = {
            method: "POST",
            json: true,
            uri: uri,
            body: body,
            headers: {},
        };
        if (this.slackBotToken) {
            sendMessageParams.headers = {
                Authorization: `Bearer ${this.slackBotToken}`
            };
            // See https://api.slack.com/methods/chat.postMessage#authorship
            // Setting as_user to false means "When the as_user parameter is set to
            // false, messages are posted as "bot_messages", with message authorship
            // attributed to the user name"
            sendMessageParams.body.as_user = false;
            sendMessageParams.body.channel = this.slackChannelId;
        }
        sendMessageParams.body.username = user.getDisplaynameForRoom(message.room_id);
        const reply = await this.findParentReply(message);
        if (reply !== message.event_id) {
            // We have a reply
            const parentStoredEvent = await this.main.eventStore.getEntryByMatrixId(message.room_id, reply);
            sendMessageParams.body.thread_ts = parentStoredEvent.remoteEventId;
        }
        const avatar_url = user.getAvatarUrlForRoom(message.room_id);
        if (avatar_url && avatar_url.indexOf("mxc://") === 0) {
            sendMessageParams.body.icon_url = this.main.getUrlForMxc(avatar_url);
        }
        user.bumpATime();
        this.matrixATime = Date.now() / 1000;
        const res = await rp(sendMessageParams);
        this.main.incCounter("sent_messages", { side: "remote" });
        if (!res || !res.ok) {
            log.error("HTTP Error: ", res);
        }
        else {
            // Add this event to the event store
            const event = new matrix_appservice_bridge_1.StoreEvent(message.room_id, message.event_id, this.slackChannelId, res.ts);
            this.main.eventStore.upsertEvent(event);
        }
        return res;
    }
    async onSlackMessage(message) {
        try {
            const ghost = await this.main.getGhostForSlackMessage(message);
            await ghost.update(message, this);
            return await this.handleSlackMessage(message, ghost);
        }
        catch (err) {
            log.error("Failed to process event");
            log.error(err);
        }
    }
    async onSlackReactionAdded(message) {
        if (message.user_id === this.slackUserId) {
            return;
        }
        const ghost = await this.main.getGhostForSlackMessage(message);
        await ghost.update(message, this);
        const reaction = `:${message.reaction}:`;
        let reaction_key = emoji.emojify(reaction, substitutions_1.onMissingEmoji);
        const eventStore = this.main.eventStore;
        const event = await eventStore.getEntryByRemoteId(message.item.channel, message.item.ts);
        return ghost.sendReaction(this.MatrixRoomId, event.eventId, reaction_key, message.item.channel, message.event_ts);
    }
    async handleSlackMessage(message, ghost) {
        const eventTS = message.event_ts;
        const channelId = this.slackChannelId;
        ghost.bumpATime();
        this.slackATime = Date.now() / 1000;
        const subtype = message.subtype;
        // Transform the text if it is present.
        if (message.text) {
            message.text = substitutions_1.default.slackToMatrix(message.text, subtype === "file_comment" ? message.file : undefined);
        }
        if (message.thread_ts !== undefined) {
            const eventStore = this.main.eventStore;
            // Get parent event
            const parentEvent = await eventStore.getEntryByRemoteId(this.SlackChannelId, message.thread_ts);
            let replyToTS = "";
            // Add this event to the list of events in this thread
            if (parentEvent._extras.slackThreadMessages === undefined) {
                parentEvent._extras.slackThreadMessages = [];
            }
            replyToTS = parentEvent._extras.slackThreadMessages.slice(-1)[0] || message.thread_ts;
            parentEvent._extras.slackThreadMessages.push(message.ts);
            await eventStore.upsertEvent(parentEvent);
            // Get event to reply to
            const replyToEvent = await eventStore.getEntryByRemoteId(this.SlackChannelId, replyToTS);
            const m_in_reply_to = { "m.in_reply_to": { event_id: replyToEvent.eventId } };
            const extraContent = { "m.relates_to": m_in_reply_to };
            return ghost.sendText(this.MatrixRoomId, message.text, this.SlackChannelId, eventTS, extraContent);
        }
        // If we are only handling text, send the text.
        if ([undefined, "bot_message", "file_comment"].includes(subtype)) {
            return ghost.sendText(this.matrixRoomId, message.text, channelId, eventTS);
        }
        // emotes
        else if (subtype === "me_message") {
            message = {
                msgtype: "m.emote",
                body: message.text
            };
            return ghost.sendMessage(this.matrixRoomId, message, channelId, eventTS);
        }
        // edits
        else if (subtype === "message_changed") {
            const previous_message = ghost.prepareBody(substitutions_1.default.slackToMatrix(message.previous_message.text));
            // We use message.text here rather than the proper message.message.text
            // as we have added message.text ourselves and then transformed it.
            const new_message_rich = substitutions_1.default.slackToMatrix(message.text);
            const new_message = ghost.prepareBody(new_message_rich);
            // The substitutions might make the messages the same
            if (previous_message === new_message) {
                log.debug("Ignoring edit message because messages are the same post-substitutions.");
                return;
            }
            const edits = substitutions_1.default.makeDiff(previous_message, new_message);
            const outtext = "(edited) " +
                edits.before + edits.prev + edits.after + " => " +
                edits.before + edits.curr + edits.after;
            const prev = substitutions_1.default.htmlEscape(edits.prev);
            const curr = substitutions_1.default.htmlEscape(edits.curr);
            const before = substitutions_1.default.htmlEscape(edits.before);
            const after = substitutions_1.default.htmlEscape(edits.after);
            const formatted = `<i>(edited)</i> ${before} <font color="red"> ${prev} </font> ${after} =&gt; ${before} <font color="green"> ${curr} </font> ${after}`;
            const prev_event = await this.main.eventStore.getEntryByRemoteId(channelId, message.previous_message.ts);
            const matrixcontent = {
                body: ghost.prepareBody(outtext),
                msgtype: "m.text",
                formatted_body: formatted,
                format: "org.matrix.custom.html",
                "m.relates_to": {
                    rel_type: "m.replace",
                    event_id: prev_event.eventId
                },
                "m.new_content": {
                    msgtype: "m.text",
                    body: ghost.prepareBody(new_message_rich),
                    formatted_body: ghost.prepareFormattedBody(new_message_rich),
                    format: "org.matrix.custom.html"
                }
            };
            return ghost.sendMessage(this.MatrixRoomId, matrixcontent, channelId, eventTS);
        }
        else if (message.files != undefined) {
            for (var i = 0; i < message.files.length; i++) {
                const file = message.files[i];
                if (file.mode === "snippet") {
                    let htmlString;
                    try {
                        htmlString = await rp({
                            uri: file.url_private,
                            headers: {
                                Authorization: `Bearer ${this.slackBotToken}`,
                            }
                        });
                    }
                    catch (ex) {
                        log.error("Failed to download snippet", ex);
                        continue;
                    }
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
                    htmlCode += substitutions_1.default.htmlEscape(htmlString);
                    htmlCode += '</code></pre>';
                    const content = {
                        body: code,
                        msgtype: "m.text",
                        formatted_body: htmlCode,
                        format: "org.matrix.custom.html"
                    };
                    await ghost.sendMessage(this.matrixRoomId, content, channelId, eventTS);
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(this.matrixRoomId, message.text, channelId, eventTS);
                    }
                }
                // A file which is not a snippet
                else {
                    // We also need to upload the thumbnail
                    let thumbnail_promise = Promise.resolve();
                    // Slack ain't a believer in consistency.
                    const thumb_uri = file.thumb_video || file.thumb_360;
                    if (thumb_uri && file.filetype) {
                        thumbnail_promise = ghost.uploadContentFromURI({
                            title: `${file.name}_thumb.${file.filetype}`,
                            mimetype: file.mimetype,
                        }, thumb_uri, this.slackBotToken);
                    }
                    let content_uri = "";
                    const fileContentUri = await ghost.uploadContentFromURI(file, file.url_private, this.slackBotToken);
                    const thumbnailContentUri = await thumbnail_promise;
                    await ghost.sendMessage(this.matrixRoomId, slackFileToMatrixMessage(file, fileContentUri, thumbnailContentUri), channelId, eventTS);
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(this.matrixRoomId, message.text, channelId, eventTS);
                    }
                }
            }
        }
        else {
            log.warn("Ignoring message with subtype: " + subtype);
        }
    }
    async leaveGhosts(ghosts) {
        const promises = [];
        for (const ghost of ghosts) {
            promises.push(this.main.getIntent(ghost).leave(this.matrixRoomId));
        }
        await Promise.all(promises);
    }
    get RemoteATime() {
        return this.slackATime;
    }
    get MatrixATime() {
        return this.matrixATime;
    }
    async refreshTeamInfo() {
        if (!this.slackBotToken)
            return;
        const response = await rp({
            uri: 'https://slack.com/api/team.info',
            qs: {
                token: this.slackBotToken
            },
            json: true,
        });
        if (!response.team)
            return;
        this.setValue("SlackTeamDomain", response.team.domain);
        this.setValue("slackTeamId", response.team.id);
    }
    async refreshUserInfo() {
        if (!this.slackBotToken)
            return;
        const testRes = await rp({
            uri: 'https://slack.com/api/auth.test',
            qs: {
                token: this.slackBotToken
            },
            json: true,
        });
        log.debug("auth.test res:", testRes);
        if (!testRes.user_id)
            return;
        this.setValue("slackUserId", testRes.user_id);
        const usersRes = await rp({
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: this.slackBotToken,
                user: testRes.user_id,
            },
            json: true,
        });
        if (!usersRes.user || !usersRes.user.profile)
            return;
        this.setValue("slackBotId", usersRes.user.profile.bot_id);
    }
    ;
}
exports.BridgedRoom = BridgedRoom;
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
const slackImageToMatrixImage = function (file, url, thumbnail_url) {
    const message = {
        msgtype: "m.image",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
        // TODO: Define some matrix types
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
const slackImageToMatrixVideo = function (file, url, thumbnail_url) {
    const message = {
        msgtype: "m.video",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        }
        // TODO: Define some matrix types
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
const slackImageToMatrixAudio = function (file, url) {
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
const slackFileToMatrixMessage = function (file, url, thumbnail_url) {
    if (file.mimetype) {
        if (file.mimetype.startsWith("image/")) {
            return slackImageToMatrixImage(file, url, thumbnail_url);
        }
        else if (file.mimetype.startsWith("video/")) {
            return slackImageToMatrixVideo(file, url, thumbnail_url);
        }
        else if (file.mimetype.startsWith("audio/")) {
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
