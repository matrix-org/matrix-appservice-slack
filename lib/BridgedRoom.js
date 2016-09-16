"use strict";

var Promise = require('bluebird');

var substitutions = require("./substitutions");
var rp = require('request-promise');

function BridgedRoom(bridge, opts) {
    this._bridge = bridge;

    if (!opts.slack_channel_id) {
        throw new Error("BridgedRoom requires a channel ID");
    }

    this._matrix_room_ids = [];
    this._slack_channel_name = opts.slack_channel_name;
    this._slack_channel_id = opts.slack_channel_id;
    this._slack_token = opts.slack_token;
    this._slack_webhook_uri = opts.slack_webhook_uri;

    this._dirty = false;
};

BridgedRoom.prototype.getStatus = function() {
    if (!this._slack_token || !this._slack_webhook_uri) {
        return "pending-params";
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
    var room = new BridgedRoom(bridge, {
        slack_channel_id: entry.remote_id,
        slack_channel_name: entry.remote.name,
        slack_token: entry.remote.token,
        slack_webhook_uri: entry.remote.webhook_uri,
    });

    if (entry.data && entry.data.matrix_room_ids) {
        room._matrix_room_ids = entry.data.matrix_room_ids;
    }

    return room;
};

// Returns data to write to the RoomStore
// As a side-effect will also clear the isDirty() flag
BridgedRoom.prototype.toEntry = function() {
    this._dirty = false;
    var id = this._slack_channel_id;
    var entry = {
        id: id,
        remote_id: this._slack_channel_id,
        remote: {
            name: this._slack_channel_name,
            token: this._slack_token,
            webhook_uri: this._slack_webhook_uri,
        },
    };

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

    var botIntent = this._bridge.getBotIntent();
    // TODO(paul): Expose getProfileInfo as a promisified method in bridge library
    botIntent.client.getProfileInfo(message.user_id, null, (err, info) => {
        if (!err && info.displayname) {
            sendMessageParams.body.username = info.displayname;
            console.log("found displayname: " + info.displayname);
        }
        if (!err && info.avatar_url && info.avatar_url.indexOf("mxc://") === 0) {
            console.log("found avatar_url: " + info.avatar_url);
            sendMessageParams.body.icon_url = this._bridge.getUrlForMxc(info.avatar_url);
        }

        rp(sendMessageParams).then(function(res) {
            if (!res) {
                console.log("HTTP Error: %s", res);
            }
            else {
                console.log("HTTP Msg sent!  %s", res);
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
    });
};

BridgedRoom.prototype.onSlackMessage = function(message) {
    var roomIDs = this._matrix_room_ids;
    var intent = this._bridge.getIntentForSlackUsername(message.user_name);

    // TODO: store this somewhere
    intent.setDisplayName(message.user_name);

    var subtype = message.subtype;

    if (!subtype) {
        var text = substitutions.slackToMatrix(message.text);
        roomIDs.forEach((id) => intent.sendText(id, text));
    }
    else if (subtype === "me_message") {
        var message = {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        };
        roomIDs.forEach((id) => intent.sendMessage(id, message));
    }
    else if (subtype === "file_comment") {
        var text = substitutions.slackToMatrix(message.text);
        roomIDs.forEach((id) => intent.sendText(id, text));
    }
    else if (subtype === "file_share") {
        if (!message.file) {
            console.log("Ignoring non-text non-image message: " + res);
            return;
        }
        if (message.file._content) {
            // upload to media repo; get media repo URL back
            return uploadContent(message.file, intent).then((content_uri) => {
                if(undefined == content_uri) {
                    // no URL returned from media repo; abort
                   return undefined;
                }
                var matrixMessage = slackImageToMatrixImage(message.file, content_uri);
                roomIDs.forEach((id) => intent.sendMessage(id, matrixMessage));
            }).finally(() => {
                var text = substitutions.slackToMatrix(
                    message.file.initial_comment.comment
                );
                roomIDs.forEach((id) => intent.sendText(id, text));
            });
        }
    }
    else {
        console.log("Ignoring message with subtype: " + subtype);
    }
};

var uploadContent = function(file, intent) {
    return intent.getClient().uploadContent({
            stream: new Buffer(file._content, "binary"),
            name: file.title,
            type: file.mimetype,
    }).then((response) => {
        var content_uri = JSON.parse(response).content_uri;

        console.log("Media uploaded to " + content_uri);
        return content_uri;
    });

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
