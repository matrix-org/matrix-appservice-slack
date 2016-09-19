"use strict";

function SlackGhost(opts) {
    this._intent = opts.intent;
}

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
