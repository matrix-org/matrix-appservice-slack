"use strict";

function Rooms(config) {
    this.slack_channels = {};
    this.matrix_rooms = {};
    for (var i = 0; i < config.rooms.length; ++i) {
        var room = config.rooms[i];
        this.slack_channels[room["slack_channel_id"]] = room;
        this.matrix_rooms[room["matrix_room_id"]] = room;
    }
}

Rooms.prototype.addRoom = function (
    slack_channel_id, slack_api_token,
    matrix_room_id, webhook_url) {
        if (! (slack_channel_id && matrix_room_id)) {
            throw new Error('Slack channel ID and Matrix room ID required');
        }

        var room = {
            slack_channel_id : slack_channel_id,
            slack_api_token : slack_api_token,
            matrix_room_id : matrix_room_id,
            webhook_url : webhook_url
        };

        this.slack_channels[slack_channel_id] = room;
        this.matrix_rooms[matrix_room_id] = room;
};

Rooms.prototype.removeRoom = function (slack_channel_id, matrix_room_id) {
    delete this.slack_channels[slack_channel_id];
    delete this.matrix_rooms[matrix_room_id];
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
