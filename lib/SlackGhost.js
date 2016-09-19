"use strict";

var rp = require('request-promise');

function SlackGhost(opts) {
    this._bridge = opts.bridge;

    this._user_id = opts.user_id;
    this._display_name = opts.display_name;

    this._intent = opts.intent;
}

SlackGhost.fromEntry = function(bridge, entry, intent) {
    return new SlackGhost({
        bridge: bridge,

        user_id: entry.id,
        display_name: entry.display_name,

        intent: intent,
    });
};

SlackGhost.prototype.toEntry = function() {
    var entry = {
        id: this._user_id,
        display_name: this._display_name,
    };

    return entry;
};

SlackGhost.prototype.getIntent = function() {
    return this._intent;
};

SlackGhost.prototype.update = function(message) {
    return Promise.all([
        this.updateDisplayname(message.user_name),
        this.updateAvatar(message),
    ]).catch((e) => {
        console.log("Ghost update failed:", e);
    });
};

SlackGhost.prototype.updateDisplayname = function(display_name) {
    if (this._display_name === display_name) return Promise.resolve();

    return this.getIntent().setDisplayName(display_name).then(() => {
        this._display_name = display_name;
        return this._bridge.putUserToStore(this);
    });
};

SlackGhost.prototype.updateAvatar = function(message) {
    var team_token = this._bridge.getTeamToken(message.team_domain);
    if (!team_token) return Promise.resolve();

    // TODO(paul): cache these lookups from slack for (a configurable) 10 minutes
    return rp({
        uri: 'https://slack.com/api/users.info',
        qs: {
            token: team_token,
            user: message.user_id,
        },
        json: true,
    }).then((response) => {
        if (!response.user || !response.user.profile) return;

        var avatar_url = response.user.profile.image_original;
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
            this._bridge.putUserToStore(this);
        });
    });
};

SlackGhost.prototype.sendText = function(room_id, text) {
    this.getIntent().sendText(room_id, text);
};

SlackGhost.prototype.sendMessage = function(room_id, msg) {
    this.getIntent().sendMessage(room_id, msg);
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

module.exports = SlackGhost;
