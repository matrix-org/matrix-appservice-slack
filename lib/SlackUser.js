"use strict";

function SlackUser(opts) {
    this._intent = opts.intent;
}

SlackUser.prototype.getIntent = function() {
    return this._intent;
};

SlackUser.prototype.sendText = function(room_id, text) {
    this.getIntent().sendText(room_id, text);
};

SlackUser.prototype.sendMessage = function(room_id, msg) {
    this.getIntent().sendMessage(room_id, msg);
};

SlackUser.prototype.uploadContent = function(file) {
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

module.exports = SlackUser;
