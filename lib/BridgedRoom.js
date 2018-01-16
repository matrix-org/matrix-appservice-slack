"use strict";

var Promise = require('bluebird');

var substitutions = require("./substitutions");
var rp = require('request-promise');

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
  console.log('updateAccessToken ->', token, scopes);
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

BridgedRoom.prototype.onMatrixMessage = function(message) {
    if (!this._slack_webhook_uri && !this._slack_bot_token) return Promise.resolve();

    return this._main.getOrCreateMatrixUser(message.user_id).then((user) => {
        var body = substitutions.matrixToSlack(message, this._main);

        var uri = (this._slack_bot_token) ? "https://slack.com/api/chat.postMessage" : this._slack_webhook_uri;

        var sendMessageParams = {
            method: "POST",
            json: true,
            uri: uri,
            body: body,
        };

        if (this._slack_bot_token) {
            sendMessageParams.headers = {
                Authorization: 'Bearer ' + this._slack_bot_token
            };
            sendMessageParams.body.as_user = false;
            sendMessageParams.body.channel = this._slack_channel_id;
        }

        sendMessageParams.body.username = user.getDisplaynameForRoom(message.room_id);

        var avatar_url = user.getAvatarUrlForRoom(message.room_id);

        if (avatar_url && avatar_url.indexOf("mxc://") === 0) {
            sendMessageParams.body.icon_url = this._main.getUrlForMxc(avatar_url);
        }

        user.bumpATime();
        this._matrixAtime = Date.now() / 1000;

        return rp(sendMessageParams).then((res) => {
            this._main.incCounter("sent_messages", {side: "remote"});
            if (!res || (this._slack_bot_token && !res.ok)) {
                console.log("HTTP Error: ", res);
            }
        });
    });
};

BridgedRoom.prototype.onSlackMessage = function(message) {
    return this._main.getGhostForSlackMessage(message).then((ghost) => {
        return ghost.update(message, this).then(() => {
            return this._handleSlackMessage(message, ghost);
        });
    });
};

BridgedRoom.prototype._handleSlackMessage = function(message, ghost) {
    var roomID = this.getMatrixRoomId();

    ghost.bumpATime();
    this._slackAtime = Date.now() / 1000;

    var subtype = message.subtype;

    if (!subtype || subtype === "bot_message") {
        var text = substitutions.slackToMatrix(message.text);
        return ghost.sendText(roomID, text);
    }
    else if (subtype === "me_message") {
        var message = {
            msgtype: "m.emote",
            body: substitutions.slackToMatrix(message.text)
        };
        return ghost.sendMessage(roomID, message);
    }
    else if (subtype === "file_comment") {
        var text = substitutions.slackToMatrix(message.text, message.file);
        return ghost.sendText(roomID, text);
    }
    else if (subtype === "file_share") {
        if (!message.file) {
            console.log("Ignoring missing file message: " + message);
            return;
        }
        if (message.file._content) {
            // TODO: Currently Matrix lacks a way to upload a "captioned image",
            //   so we just send a separate `m.image` and `m.text` message
            // See https://github.com/matrix-org/matrix-doc/issues/906

            // upload to media repo; get media repo URL back
            return ghost.uploadContent(message.file).then((content_uri) => {
                if(undefined == content_uri) {
                    // no URL returned from media repo; abort
                   return undefined;
                }
                var matrixMessage = slackFileToMatrixMessage(message.file, content_uri);
                return ghost.sendMessage(roomID, matrixMessage);
            }).finally(() => {
                if (message.file.initial_comment) {
                    var text = substitutions.slackToMatrix(
                        message.file.initial_comment.comment
                    );
                    return ghost.sendText(roomID, text);
                }
            });
        } else {
            // post a msg with the link
            var text = substitutions.slackToMatrix(message.text, message.file);
            return ghost.sendText(roomID, text);
        }
    }
    else {
        console.log("Ignoring message with subtype: " + subtype);
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

/**
 * Converts a slack file upload to a matrix file upload event.
 *
 * @param {Object} file The slack file object.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/#m-file
 */
var slackFileToMatrixMessage = function(file, url) {
    if (file.mimetype && file.mimetype.indexOf("image/") === 0) {
        return slackImageToMatrixImage(file, url);
    }

    var message = {
        msgtype: "m.file",
        url: url,
        body: file.title,
        info: {
            mimetype: file.mimetype
        }
    };
    if (file.size) {
        message.info.size = file.size;
    }
    return message;
};

BridgedRoom.prototype.getRemoteATime = function() {
    return this._slackAtime;
};

BridgedRoom.prototype.getMatrixATime = function() {
    return this._matrixAtime;
};

BridgedRoom.prototype.lookupAndSetTeamInfo = function() {
    if (!this._slack_bot_token) return Promise.resolve();

    return rp({
        uri: 'https://slack.com/api/team.info',
        qs: {
            token: this._slack_bot_token
        },
        json: true,
    }).then((response) => {
        if (!response.team) return;

        if (!this._slack_team_domain !== response.team.domain) {
            this._slack_team_domain = response.team.domain;
            this._dirty = true;
        }

        if (!this._slack_team_id !== response.team.id) {
            this._slack_team_id = response.team.id;
            this._dirty = true;
        }
    });
};

BridgedRoom.prototype.lookupAndSetUserInfo = function() {
    if (!this._slack_bot_token) return Promise.resolve();

    return rp({
        uri: 'https://slack.com/api/auth.test',
        qs: {
            token: this._slack_bot_token
        },
        json: true,
    }).then((response) => {
        console.log(response);
        if (!response.user_id) return;

        if (!this._slack_user_id !== response.user_id) {
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
        if (!response.user && response.user.profile) return Promise.resolve();

        if (!this._slack_bot_id !== response.user.profile.bot_id) {
            this._slack_bot_id = response.user.profile.bot_id;
            this._dirty = true;
        }
    });
};

module.exports = BridgedRoom;
