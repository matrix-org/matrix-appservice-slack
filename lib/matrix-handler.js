"use strict";

var substitutions = require("./substitutions");

/**
 * @constructor
 * @param {Rooms} rooms mapping of all known slack channels to matrix rooms.
 * @param {request} requestLib request library, for sending HTTP requests.
 */
function MatrixHandler(rooms, requestLib) {
    this.rooms = rooms;
    this.requestLib = requestLib;
}

/**
 * Handles a matrix event.
 *
 * Sends a message to Slack if it understands enough of the event to do so.
 * Attempts to make the message as native-slack feeling as it can.
 *
 * @param {MatrixEvent} event the matrix event.
 */
MatrixHandler.prototype.handle = function(event) {
    if (event.type !== "m.room.message" || !event.content) {
        return;
    }
    var hookURL = this.rooms.webhookForMatrixRoomID(event.room_id);
    if (!hookURL) {
        console.log("Ignoring event for matrix room with unknown slack channel:" +
            event.room_id);
        return;
    }
    this.requestLib({
        method: "POST",
        json: true,
        uri: hookURL,
        body: substitutions.matrixToSlack(event),
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
