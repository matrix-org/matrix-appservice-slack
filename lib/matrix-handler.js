"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');

/**
 * @constructor
 * @param {Object} config the configuration of the bridge.
 *     See ../config/slack-config-schema.yaml for the schema to which this must conform.
 * @param {Rooms} rooms mapping of all known slack channels to matrix rooms.
 * @param {request} requestLib request library, for sending HTTP requests.
 */
function MatrixHandler(config, rooms, requestLib, qs) {
    this.config = config;
    this.rooms = rooms;
    this.requestLib = requestLib;
    this.qs = qs;
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
    var body = substitutions.matrixToSlack(event, this.config.homeserver);

    var getProfileParams = {
        uri: "https://matrix.org/_matrix/client/r0/profile/" + this.qs.escape(event.user_id),
        method: "GET",
        json: true
    };

    var sendMessageParams = {
        method: "POST",
        json: true,
        uri: hookURL,
        body: body
    };

    // attempt to look up displayname and avatar_url - then send the message
    rp(getProfileParams).then(function(res) {
        if (res) {
            if (res.displayname) {
                sendMessageParams.body.username = res.displayname;
                console.log("found displayname: " + res.displayname);
            }
            if (res.avatar_url && res.avatar_url.indexOf("mxc://") === 0) {
                console.log("found avatar_url: " + res.avatar_url);
                sendMessageParams.body.icon_url = "https://matrix.org/_matrix/media/v1/download/" + res.avatar_url.substring("mxc://".length);
            }
        }
    }).finally(function() {
        sendMessage(sendMessageParams)
    });
};

var sendMessage = function(options) {
    rp(options).then(function(res) {
        if (!res) {
            console.log("HTTP Error: %s", res);
        }
        else {
            console.log("HTTP Msg sent!  %s", res);
        }
    });
};

module.exports = MatrixHandler;
