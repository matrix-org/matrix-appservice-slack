"use strict";

var Promise = require('bluebird');

var substitutions = require("./substitutions");
var rp = require('request-promise');

function BridgedRoom(bridge, opts) {
    this._bridge = bridge;

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
    this._access_token = opts.access_token;
    this._access_scopes = opts.access_scopes;

    this._slackAtime = null;  // last activity time in epoch seconds
    this._matrixAtime = null;

    this._dirty = true;
};

BridgedRoom.prototype.getStatus = function() {
    if (!this._slack_webhook_uri) {
        return "pending-params";
    }
    if (!this._slack_channel_name) {
        return "pending-name";
    }
    if (!this._access_token) {
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
    return this._access_token;
};

BridgedRoom.prototype.getMatrixRoomId = function() {
    return this._matrix_room_id;
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

BridgedRoom.prototype.updateAccessToken = function(token, scopes) {
    if (this._access_token === token &&
        this._access_scopes.sort().join(",") === scopes.sort().join(",")) return;

    this._access_token = token;
    this._access_scopes = scopes;
    this._dirty = true;
};

BridgedRoom.fromEntry = function(bridge, entry) {
    var opts = {
        inbound_id: entry.remote_id,
        matrix_room_id: entry.matrix_id,
        slack_channel_id: entry.remote.id,
        slack_channel_name: entry.remote.name,
        slack_webhook_uri: entry.remote.webhook_uri,
        access_token: entry.remote.access_token,
        access_scopes: entry.remote.access_scopes,
    };

    return new BridgedRoom(bridge, opts);
};

// Returns data to write to the RoomStore
// As a side-effect will also clear the isDirty() flag
BridgedRoom.prototype.toEntry = function() {
    var entry = {
        remote: {
            id: this._slack_channel_id,
            name: this._slack_channel_name,
            webhook_uri: this._slack_webhook_uri,
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

BridgedRoom.prototype.onMatrixMessage = function(message) {
    if (!this._slack_webhook_uri) return Promise.resolve();

    return this._bridge.getOrCreateMatrixUser(message.user_id).then((user) => {
        var body = substitutions.matrixToSlack(message, this._bridge);

        var sendMessageParams = {
            method: "POST",
            json: true,
            uri: this._slack_webhook_uri,
            body: body
        };

        sendMessageParams.body.username = user.getDisplaynameForRoom(message.room_id);

        var avatar_url = user.getAvatarUrlForRoom(message.room_id);

        if (avatar_url && avatar_url.indexOf("mxc://") === 0) {
            sendMessageParams.body.icon_url = this._bridge.getUrlForMxc(avatar_url);
        }

        user.bumpATime();
        this._matrixAtime = Date.now() / 1000;

        return rp(sendMessageParams).then((res) => {
            this._bridge.incCounter("sent_messages", {side: "remote"});
            if (!res) {
                console.log("HTTP Error: %s", res);
            }
        });
    });
};

BridgedRoom.prototype.onSlackMessage = function(message) {
    return this._bridge.getGhostForSlackMessage(message).then((ghost) => {
        return ghost.update(message, this).then(() => {
            this._handleSlackMessage(message, ghost);
        });
    });
};

BridgedRoom.prototype._handleSlackMessage = function(message, ghost) {
    var roomID = this.getMatrixRoomId();

    ghost.bumpATime();
    this._slackAtime = Date.now() / 1000;

    var subtype = message.subtype;

    if (!subtype) {
        var text = substitutions.slackToMatrix(message.text);
        ghost.sendText(roomID, text);
    }
    else if (subtype === "me_message") {
        var message = {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        };
        ghost.sendMessage(roomID, message);
    }
    else if (subtype === "file_comment") {
        var text = substitutions.slackToMatrix(message.text);
        ghost.sendText(roomID, text);
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
                ghost.sendMessage(roomID, matrixMessage);
            }).finally(() => {
                var text = substitutions.slackToMatrix(
                    message.file.initial_comment.comment
                );
                ghost.sendText(roomID, text);
            });
        }
    }
    else {
        console.log("Ignoring message with subtype: " + subtype);
    }
};

BridgedRoom.prototype.leaveGhosts = function(ghosts) {
    var roomID = this.getMatrixRoomId();
    var bridge = this._bridge;

    return Promise.each(ghosts,
        (ghost) => {
            var intent = bridge._bridge.getIntent(ghost);
            this._bridge.incMatrixCallCounter("leave");
            return intent.leave(roomID);
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

BridgedRoom.prototype.getRemoteATime = function() {
    return this._slackAtime;
};

BridgedRoom.prototype.getMatrixATime = function() {
    return this._matrixAtime;
};

module.exports = BridgedRoom;
