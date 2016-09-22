"use strict";

var Promise = require('bluebird');

var substitutions = require("./substitutions");
var rp = require('request-promise');

function BridgedRoom(bridge, opts) {
    this._bridge = bridge;

    if (!opts.slack_channel_id && !opts.inbound_id) {
        throw new Error("BridgedRoom requires at least one of channel ID, or inbound ID");
    }

    this._matrix_room_ids = [];
    this._inbound_id = opts.inbound_id;
    this._slack_channel_name = opts.slack_channel_name;
    this._slack_channel_id = opts.slack_channel_id;
    this._slack_token = opts.slack_token;
    this._slack_webhook_uri = opts.slack_webhook_uri;

    this._dirty = true;
};

BridgedRoom.prototype.isLegacy = function() {
    return !this._inbound_id;
};

BridgedRoom.prototype.getStatus = function() {
    if (!this._slack_webhook_uri) {
        return "pending-params";
    }
    // legacy-style rooms need a token
    if (this.isLegacy() && !this._slack_token) {
        return "pending-params";
    }
    if (this._upgrade_pending) {
        return "pending-upgrade";
    }
    if (!this._slack_channel_name) {
        return "pending-name";
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

BridgedRoom.prototype.getSlackToken = function() {
    return this._slack_token;
}

BridgedRoom.prototype.getSlackWebhookUri = function() {
    return this._slack_webhook_uri;
};

BridgedRoom.prototype.hasMatrixRoomId = function(room_id) {
    return this._matrix_room_ids.indexOf(room_id) !== -1;
};

BridgedRoom.prototype.getMatrixRoomIds = function() {
    return this._matrix_room_ids;
};

BridgedRoom.prototype.addMatrixRoomId = function(room_id) {
    if (this._matrix_room_ids.indexOf(room_id) === -1) {
        if (!this.isLegacy() && this._matrix_room_ids.length) {
            throw new Error("Cannot link new-style BridgedRoom to multiple Matrix rooms");
        }
        this._matrix_room_ids.push(room_id);
    }
};

BridgedRoom.prototype.removeMatrixRoomId = function(room_id) {
    var idx;
    if ((idx = this._matrix_room_ids.indexOf(room_id)) !== -1) {
        this._matrix_room_ids.splice(idx, 1);
        return true;
    }
    return false;
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

BridgedRoom.prototype.updateSlackToken = function(slack_token) {
    if (this._slack_token !== slack_token) this._dirty = true;
    this._slack_token = slack_token;
};

BridgedRoom.prototype.updateSlackWebhookUri = function(slack_webhook_uri) {
    if (this._slack_webhook_uri !== slack_webhook_uri) this._dirty = true;
    this._slack_webhook_uri = slack_webhook_uri;
};

BridgedRoom.prototype.authenticateMessage = function(message) {
    return message.token && this._slack_token &&
        message.token === this._slack_token;
};

BridgedRoom.fromEntry = function(bridge, entry) {
    var opts = {
        slack_channel_name: entry.remote.name,
        slack_token: entry.remote.token,
        slack_webhook_uri: entry.remote.webhook_uri,
    };
    if (entry.matrix_id) {
        // A new-style BridgedRoom
        opts.inbound_id = entry.remote_id;
        opts.slack_channel_id = entry.remote.id;
    }
    else {
        opts.slack_channel_id = entry.remote_id;
    }

    var room = new BridgedRoom(bridge, opts);

    if (entry.matrix_id) {
        // A new-style BridgedRoom
        room._matrix_room_ids = [entry.matrix_id];
        room._upgrade_pending = entry.remote.upgrade_pending;
    }

    return room;
};

// Returns data to write to the RoomStore
// As a side-effect will also clear the isDirty() flag
BridgedRoom.prototype.toEntry = function() {
    var entry = {
        remote: {
            id: this._slack_channel_id,
            name: this._slack_channel_name,
            token: this._slack_token,
            webhook_uri: this._slack_webhook_uri,
        },
    };

    if (this.isLegacy()) {
        entry.id = this._slack_channel_id;
        entry.remote_id = this._slack_channel_id;
    }
    else {
        if (this._matrix_room_ids.length !== 1) {
            throw new Error("Cannot .toEntry() a new-style BridgedRoom without exactly one Matrix room ID");
        }

        entry.id = "INTEG-" + this._inbound_id;
        entry.matrix_id = this._matrix_room_ids[0];
        entry.remote_id = this._inbound_id;

        entry.remote.upgrade_pending = this._upgrade_pending;
    }

    this._dirty = false;
    return entry;
};

BridgedRoom.prototype.onMatrixMessage = function(message) {
    if (!this._slack_webhook_uri) return Promise.resolve();

    var body = substitutions.matrixToSlack(message, this._bridge);

    var sendMessageParams = {
        method: "POST",
        json: true,
        uri: this._slack_webhook_uri,
        body: body
    };

    // TODO(paul): consider stealing the displayname disambiguation logic
    //   out of matrix-appservice-gitter
    var member_event = this._bridge.getStoredEvent(
        message.room_id, "m.room.member", message.user_id
    );
    var content = member_event && member_event.content;

    if (content && content.displayname) {
        sendMessageParams.body.username = content.displayname;
    }
    if (content.avatar_url && content.avatar_url.indexOf("mxc://") === 0) {
        sendMessageParams.body.icon_url = this._bridge.getUrlForMxc(content.avatar_url);
    }

    rp(sendMessageParams).then((res) => {
        this._bridge.incCounter("sent_messages", {side: "remote"});
        if (!res) {
            console.log("HTTP Error: %s", res);
        }
    });

    // Reflect the message back into other Matrix-side rooms
    this.getMatrixRoomIds().forEach((id) => {
        if (id === message.room_id) return;

        // Now this is awkward. We want to represent that a user did a
        // thing in other Matrix rooms. But we can't just puppet their
        // user account, nor can we make a relaybot-ghost like the
        // gitter bridge does, because the slack bridge doesn't actually
        // have a real Slack-side user to ghost into Matrix.
        console.log("TODO: Reflect message from " + message.room_id +
                    " by " + message.sender + " into " + id);
    });
};

BridgedRoom.prototype.onSlackMessage = function(message) {
    this._bridge.getGhostForSlackMessage(message).then((ghost) => {
        this._handleSlackMessage(message, ghost);
    });
};

BridgedRoom.prototype._handleSlackMessage = function(message, ghost) {
    var roomIDs = this._matrix_room_ids;
    ghost.update(message);

    var subtype = message.subtype;

    if (!subtype) {
        var text = substitutions.slackToMatrix(message.text);
        roomIDs.forEach((id) => ghost.sendText(id, text));
    }
    else if (subtype === "me_message") {
        var message = {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        };
        roomIDs.forEach((id) => ghost.sendMessage(id, message));
    }
    else if (subtype === "file_comment") {
        var text = substitutions.slackToMatrix(message.text);
        roomIDs.forEach((id) => ghost.sendText(id, text));
    }
    else if (subtype === "file_share") {
        if (!message.file) {
            console.log("Ignoring non-text non-image message: " + res);
            return;
        }
        if (message.file._content) {
            // upload to media repo; get media repo URL back
            return ghost.uploadContent(message.file).then((content_uri) => {
                if(undefined == content_uri) {
                    // no URL returned from media repo; abort
                   return undefined;
                }
                var matrixMessage = slackImageToMatrixImage(message.file, content_uri);
                roomIDs.forEach((id) => ghost.sendMessage(id, matrixMessage));
            }).finally(() => {
                var text = substitutions.slackToMatrix(
                    message.file.initial_comment.comment
                );
                roomIDs.forEach((id) => ghost.sendText(id, text));
            });
        }
    }
    else {
        console.log("Ignoring message with subtype: " + subtype);
    }
};

BridgedRoom.prototype.listAllUsers = function() {
    var botIntent = this._bridge.getBotIntent();
    return botIntent.roomState(this._matrix_room_ids[0]).then((events) => {
        // Filter for m.room.member with membership="join"
        events = events.filter(
            (ev) => ev.type === "m.room.member" && ev.membership === "join"
        );

        return events.map((ev) => ev.state_key);
    });
};

BridgedRoom.prototype.listGhostUsers = function() {
    this.listAllUsers().then((user_ids) => {
        // Filter for only those users matching the prefix
        var regexp = new RegExp("^@" + this._bridge._config.username_prefix);
        return events.filter((id) => id.match(regexp));
    });
};

BridgedRoom.prototype.leaveGhosts = function(ghosts) {
    var roomIDs = this.getMatrixRoomIds();
    var bridge = this._bridge;

    return Promise.each(ghosts,
        (ghost) => {
            var intent = bridge._bridge.getIntent(ghost);
            this._bridge.incMatrixCallCounter("leave");
            return intent.leave(roomIDs[0]);
        }
    )
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

module.exports = BridgedRoom;
