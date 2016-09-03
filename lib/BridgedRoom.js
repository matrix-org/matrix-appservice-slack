"use strict";

function BridgedRoom(opts) {
    this._bridge = opts.bridge;

    this.matrix_room_id = opts.matrix_room_id;
    this.slack_channel_id = opts.slack_channel_id;
    this.slack_token = opts.slack_token;
    this.slack_webhook_uri = opts.slack_webhook_uri;
};

module.exports = BridgedRoom;
