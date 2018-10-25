"use strict";

var url = require('url');
var https = require('https');
var rp = require('request-promise');
const Slackdown = require('Slackdown');
const substitutions = require("./substitutions");
const log = require("matrix-appservice-bridge").Logging.get("SlackGhost");

// How long in milliseconds to cache user info lookups.
var USER_CACHE_TIMEOUT = 10 * 60 * 1000;  // 10 minutes

function SlackGhost(opts) {
    this._main = opts.main;

    this._user_id = opts.user_id;
    this._display_name = opts.display_name;
    this._avatar_url = opts.avatar_url;

    this._intent = opts.intent;

    this._atime = null; // last activity time in epoch seconds
}

SlackGhost.fromEntry = function(main, entry, intent) {
    return new SlackGhost({
        main: main,

        user_id: entry.id,
        display_name: entry.display_name,
        avatar_url: entry.avatar_url,

        intent: intent,
    });
};

SlackGhost.prototype.toEntry = function() {
    var entry = {
        id: this._user_id,
        display_name: this._display_name,
        avatar_url: this._avatar_url,
    };

    return entry;
};

SlackGhost.prototype.getIntent = function() {
    return this._intent;
};

SlackGhost.prototype.update = function(message, room) {
    log.info("Updating user information for " + message.user_id);
    return Promise.all([
        this.updateDisplayname(message, room).catch((e) => {
            log.error("Failed to update ghost displayname:", e);
        }),
        this.updateAvatar(message, room).catch((e) => {
            log.error("Failed to update ghost avatar:", e);
        }),
    ]);
};

SlackGhost.prototype.getDisplayName = function(user_id, access_token) {
    return this.lookupUserInfo(user_id, access_token).then(user => {
        if (user && user.profile) {
            return user.profile.display_name || user.profile.real_name;
        }
    });
}

SlackGhost.prototype.updateDisplayname = function(message, room) {
    var display_name = message.user_name;

    var getDisplayName;
    if (!display_name) {
        getDisplayName = this.getDisplayName(message.user_id, room.getAccessToken());
    } else {
        getDisplayName = Promise.resolve(display_name);
    }

    return getDisplayName.then(display_name => {
        if (!display_name || this._display_name === display_name) return Promise.resolve();

        return this.getIntent().setDisplayName(display_name).then(() => {
            this._display_name = display_name;
            return this._main.putUserToStore(this);
        });
    })
};

SlackGhost.prototype.lookupAvatarUrl = function(user_id, token) {
    return this.lookupUserInfo(user_id, token).then((user) => {
        if (!user || !user.profile) return;
        var profile = user.profile;

        // Pick the original image if we can, otherwise pick the largest image
        // that is defined
        var avatar_url = profile.image_original ||
            profile.image_1024 || profile.image_512 || profile.image_192 ||
            profile.image_72 || profile.image_48;

        return avatar_url;
    });
};

SlackGhost.prototype.lookupUserInfo = function(user_id, token) {
    if (this._user_info_cache) return Promise.resolve(this._user_info_cache);
    if (this._loading_user) return this._loading_user;
    if (!token) return Promise.resolve();

    this._main.incRemoteCallCounter("users.info");
    this._loading_user = rp({
        uri: 'https://slack.com/api/users.info',
        qs: {
            token: token,
            user: user_id,
        },
        json: true,
    }).then((response) => {
        if (!response.user || !response.user.profile) {
            log.error("Failed to get user profile", response);
            return;
        };

        this._user_info_cache = response.user;
        setTimeout(() => { this._user_info_cache = null }, USER_CACHE_TIMEOUT);

        delete this._loading_user;
        return response.user;
    });

    return this._loading_user;
};

SlackGhost.prototype.updateAvatar = function(message, room) {
    var token = room.getAccessToken();
    if (!token) return Promise.resolve();

    return this.lookupAvatarUrl(message.user_id, token).then((avatar_url) => {
        if (this._avatar_url === avatar_url) return;

        var shortname = avatar_url.match(/\/([^\/]+)$/)[1];

        return rp({
            uri: avatar_url,
            resolveWithFullResponse: true,
            encoding: null,
        }).then((response) => {
            return this.uploadContent({
                _content: response.body,
                title: shortname,
                mimetype: response.headers["content-type"],
            });
        }).then((content_uri) => {
            this.getIntent().setAvatarUrl(content_uri);
        }).then(() => {
            this._avatar_url = avatar_url;
            this._main.putUserToStore(this);
        });
    });
};

SlackGhost.prototype.sendText = function(room_id, text) {
    // TODO: Slack's markdown is their own thing that isn't really markdown,
    // but the only parser we have for it is slackdown. However, Matrix expects
    // a variant of markdown that is in the realm of sanity. Currently text
    // will be slack's markdown until we've got a slack -> markdown parser.

    //TODO: This is fixing plaintext mentions, but should be refactored. See issue #110
    const theplaintext= text.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");

    const content = {
        body: theplaintext,
        msgtype: "m.text",
        formatted_body: Slackdown.parse(text),
        format: "org.matrix.custom.html"
    };
    return this.getIntent().sendMessage(room_id, content).then(() => {
        this._main.incCounter("sent_messages", {side: "matrix"});
    });
};

SlackGhost.prototype.sendMessage = function(room_id, msg) {
    return this.getIntent().sendMessage(room_id, msg).then(() => {
        this._main.incCounter("sent_messages", {side: "matrix"});
    });
};

SlackGhost.prototype.uploadContentFromURI = function(file, uri, token) {
    return rp({
        uri: uri,
        headers: {
            Authorization: `Bearer ${token}`,
        },
        encoding: null, // Because we expect a binary
    }).then((buffer) => {
        file._content = buffer;
        return this.uploadContent(file);
    }).then((contentUri) => {
        return contentUri;
    }).catch((reason) => {
        log.error("Failed to upload content:\n%s", reason);
        throw reason;
    });
};

SlackGhost.prototype.uploadContent = function(file) {
    return this.getIntent().getClient().uploadContent({
            stream: new Buffer(file._content, "binary"),
            name: file.title,
            type: file.mimetype,
    }).then((response) => {
        var content_uri = JSON.parse(response).content_uri;

        log.debug("Media uploaded to " + content_uri);
        return content_uri;
    });
};

SlackGhost.prototype.getATime = function() {
    return this._atime;
};

SlackGhost.prototype.bumpATime = function() {
    this._atime = Date.now() / 1000;
};

module.exports = SlackGhost;
