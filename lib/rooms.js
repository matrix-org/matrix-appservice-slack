"use strict";

function Rooms(config) {
    this.slack_channels = {};
    this.matrix_rooms = {};
    for (var i = 0; i < config.rooms.length; ++i) {
        var room = config.rooms[i];
        this.slack_channels[room["slack_channel_id"]] = room;
        this.matrix_rooms[room["matrix_room_id"]] = room
    }
}

Rooms.prototype.knowsSlackChannel = function(slack_channel_id) {
    return Boolean(this.slack_channels[slack_channel_id]);
};

Rooms.prototype.knowsMatrixRoom = function(matrix_room_id) {
    return Boolean(this.matrix_rooms[matrix_room_id]);
};

Rooms.prototype.matrixRoomID = function(slack_channel_id) {
    var channel = this.slack_channels[slack_channel_id];
    if (!channel) {
        return null;
    }
    return channel.matrix_room_id;
};

Rooms.prototype.webhookForMatrixRoomID = function(matrix_room_id) {
    var room = this.matrix_rooms[matrix_room_id];
    if (!room) {
        return null;
    }
    return room.webhook_url;
};

Rooms.prototype.slackChannelForMatrixRoomID = function(matrix_room_id) {
    var room = this.matrix_rooms[matrix_room_id];
    if (!room) {
        return null;
    }
    return room.slack_channel_id;
};

Rooms.prototype.tokenForSlackChannel = function(slack_channel_id) {
    var channel = this.slack_channels[slack_channel_id];
    if (!channel) {
        return null;
    }
    return channel.slack_api_token;
};

module.exports = Rooms;
