"use strict";

function MatrixHandler(rooms, requestLib) {
    this.rooms = rooms;
    this.requestLib = requestLib;
}

MatrixHandler.prototype.handle = function(event) {
    if (event.type !== "m.room.message" || !event.content) {
        return;
    }
    var hookURL = this.rooms.webhookForMatrixRoomID(event.room_id);
    if (!hookURL) {
        console.log("Ignoring event for matrix room with unknown slack channel:" + event.room_id);
        return;
    }
    this.requestLib({
        method: "POST",
        json: true,
        uri: hookURL,
        body: {
            username: event.user_id,
            text: event.content.body
        }
    }, function(err, res) {
        if (err) {
            console.log("HTTP Error: %s", err);
        }
        else {
            console.log("HTTP %s", res.statusCode);
        }
    });
};

module.exports = MatrixHandler;
