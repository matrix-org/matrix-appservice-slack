"use strict";

function SlackGhost(opts) {
    this._bridge = opts.bridge;

    this._user_id = opts.user_id;
    this._intent = opts.intent;
}

SlackGhost.fromEntry = function(bridge, entry, intent) {
    return new SlackGhost({
        bridge: bridge,

        user_id: entry.id,
        intent: intent,
    });
};

SlackGhost.prototype.toEntry = function() {
    var entry = {
        id: this._user_id,
    };

    return entry;
};

SlackGhost.prototype.getIntent = function() {
    return this._intent;
};

SlackGhost.prototype.update = function(message) {
    // TODO: store this somewhere
    this.getIntent().setDisplayName(message.user_name);
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
