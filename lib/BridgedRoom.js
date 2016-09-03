"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');

function BridgedRoom(opts) {
    this._bridge = opts.bridge;

    this.matrix_room_id = opts.matrix_room_id;
    this.slack_channel_id = opts.slack_channel_id;
    this.slack_token = opts.slack_token;
    this.slack_webhook_uri = opts.slack_webhook_uri;
};

BridgedRoom.prototype.onMatrixMessage = function(message) {
    var body = substitutions.matrixToSlack(message, this._bridge._config.homeserver);

    var sendMessageParams = {
        method: "POST",
        json: true,
        uri: this.slack_webhook_uri,
        body: body
    };

    var botIntent = this._bridge.getBotIntent();
    // TODO(paul): Expose getProfileInfo as a promisified method in bridge library
    botIntent.client.getProfileInfo(message.user_id, null, function(err, info) {
        if (!err && info.displayname) {
            sendMessageParams.body.username = info.displayname;
            console.log("found displayname: " + info.displayname);
        }
        if (!err && info.avatar_url && info.avatar_url.indexOf("mxc://") === 0) {
            console.log("found avatar_url: " + info.avatar_url);
            // TODO(paul): This should be my own homeserver, not matrix.org
            sendMessageParams.body.icon_url = "https://matrix.org/_matrix/media/v1/download/" + res.avatar_url.substring("mxc://".length);
        }

        rp(sendMessageParams).then(function(res) {
            if (!res) {
                console.log("HTTP Error: %s", res);
            }
            else {
                console.log("HTTP Msg sent!  %s", res);
            }
        });
    });
};

module.exports = BridgedRoom;
