"use strict";

const Promise = require('bluebird');

const url = require('url');
const substitutions = require("./substitutions");
const rp = require('request-promise');
const log = require("matrix-appservice-bridge").Logging.get("BridgedRoom");

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

BridgedRoom.prototype.onMatrixMessage = function(message) {
    if (!this._slack_webhook_uri && !this._slack_bot_token) return Promise.resolve();

    return this._main.getOrCreateMatrixUser(message.user_id).then((user) => {
        substitutions.matrixToSlack(message, this._main).then(body => {
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
                sendMessageParams.body.as_user = false;
                sendMessageParams.body.channel = this._slack_channel_id;
            }

            sendMessageParams.body.username = user.getDisplaynameForRoom(message.room_id);

            const avatar_url = user.getAvatarUrlForRoom(message.room_id);

            if (avatar_url && avatar_url.indexOf("mxc://") === 0) {
                sendMessageParams.body.icon_url = this._main.getUrlForMxc(avatar_url);
            }

            user.bumpATime();
            this._matrixAtime = Date.now() / 1000;

            return rp(sendMessageParams).then((res) => {
                this._main.incCounter("sent_messages", {side: "remote"});
                if (!res || !res.ok) {
                    log.error("HTTP Error: ", res);
                }
            });
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

    if (message.text) {
        message.text = substitutions.slackToMatrix(message.text,
            subtype === "file_comment" ? message.file : undefined);
    }

    if ([undefined, "bot_message", "file_comment"].includes(subtype)) {
        return ghost.sendText(roomID, message.text);
    }
    else if (subtype === "me_message") {
        const message = {
            msgtype: "m.emote",
            body: message.text
        };
        return ghost.sendMessage(roomID, message);
    }
    else if (subtype === "message_changed") {
        const previous_message = substitutions.slackToMatrix(message.previous_message.text);
        const new_message = substitutions.slackToMatrix(message.message.text);

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

        const matrixcontent = {
            body: outtext,
            msgtype: "m.text",
            formatted_body: formatted,
            format: "org.matrix.custom.html"
        };

        return ghost.sendMessage(roomID, matrixcontent);
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
                    return ghost.sendMessage(roomID, content);
                }).then(() => {
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(roomID, message.text);
                    }
                }).catch(function (err) {
                    log.error("Unable to download snippet", err);
                    throw err;
                });
            }
            else {
                // We also need to upload the thumbnail
                let thumbnail_promise = Promise.resolve();
                // Slack ain't a believer in consistency.
                const thumb_uri = file.thumb_video || file.thumb_360;
                if (thumb_uri) {
                    thumbnail_promise = ghost.uploadContentFromURI(
                        {
                            // Yes, we hardcode jpeg. Slack always use em.
                            title: `${file.name}_thumb.jpeg`,
                            mimetype: "image/jpeg",
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
                        slackFileToMatrixMessage(file, content_uri, thumb_content_uri)
                    );
                }).then(() => {
                    // TODO: Currently Matrix lacks a way to upload a "captioned image",
                    //   so we just send a separate `m.image` and `m.text` message
                    // See https://github.com/matrix-org/matrix-doc/issues/906
                    if (message.text) {
                        return ghost.sendText(roomID, message.text);
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
