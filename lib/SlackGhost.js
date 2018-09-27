"use strict";

var rp = require('request-promise');
var slackdown = require('Slackdown');

// How long in msec to cache avatar URL lookups from slack
var AVATAR_CACHE_TIMEOUT = 10 * 60 * 1000;  // 10 minutes

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
    return Promise.all([
        this.updateDisplayname(message, room).catch((e) => {
            console.log("Failed to update ghost displayname:", e);
        }),
        this.updateAvatar(message, room).catch((e) => {
            console.log("Failed to update ghost avatar:", e);
        }),
    ]);
};

SlackGhost.prototype.updateDisplayname = function(message, room) {
    var display_name = message.user_name;
    if (!display_name) return Promise.resolve();
    if (this._display_name === display_name) return Promise.resolve();

    return this.getIntent().setDisplayName(display_name).then(() => {
        this._display_name = display_name;
        return this._main.putUserToStore(this);
    });
};

SlackGhost.prototype.lookupAvatarUrl = function(user_id, token) {
    if (this._avatar_url_cache) return Promise.resolve(this._avatar_url_cache);

    this._main.incRemoteCallCounter("users.info");
    return rp({
        uri: 'https://slack.com/api/users.info',
        qs: {
            token: token,
            user: user_id,
        },
        json: true,
    }).then((response) => {
        if (!response.user || !response.user.profile) return;
        var profile = response.user.profile;

        // Pick the original image if we can, otherwise pick the largest image
        // that is defined
        var avatar_url = profile.image_original ||
            profile.image_1024 || profile.image_512 || profile.image_192 ||
            profile.image_72 || profile.image_48;

        this._avatar_url_cache = avatar_url;
        setTimeout(() => { this._avatar_url_cache = null }, AVATAR_CACHE_TIMEOUT);

        return avatar_url;
    });
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
    const content = {
        body: text,
        msgtype: "m.text",
        formatted_body: slackdown.parse(text),
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

SlackGhost.prototype.uploadContent = function(file) {
    return this.getIntent().getClient().uploadContent({
            stream: new Buffer(file._content, "binary"),
            name: file.title,
            type: file.mimetype,
    }).then((response) => {
        var content_uri = JSON.parse(response).content_uri;

        console.log("Media uploaded to " + content_uri);
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
