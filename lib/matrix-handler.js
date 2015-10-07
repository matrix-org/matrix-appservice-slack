"use strict";

var substitutions = require("./substitutions");

/**
 * @constructor
 * @param {Object} config the configuration of the bridge.
 *     See ../config/slack-config-schema.yaml for the schema to which this must conform.
 * @param {Rooms} rooms mapping of all known slack channels to matrix rooms.
 * @param {request} requestLib request library, for sending HTTP requests.
 */
function MatrixHandler(config, rooms, requestLib, echoSuppresser, oauth) {
    this.config = config;
    this.rooms = rooms;
    this.requestLib = requestLib;
    this.echoSuppresser = echoSuppresser;
    this.oauth = oauth;
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
    if (event.type !== "m.room.message" || !event.content ||
            this.echoSuppresser.shouldSuppress(event.event_id)) {
        return;
    }
    var hookURL = this.rooms.webhookForMatrixRoomID(event.room_id);
    if (!hookURL) {
        console.log("Ignoring event for matrix room with unknown slack channel:" +
            event.room_id);
        return;
    }
    var body = substitutions.matrixToSlack(event, this.config.homeserver);
    var req = {
        method: "POST"
    };
    var oauthToken = this.oauth.slackTokenFor(event.user_id);
    if (oauthToken) {
        hookURL = "https://slack.com/api/chat.postMessage";
        body.channel = this.rooms.slackChannelForMatrixRoomID(event.room_id);
        body.token = oauthToken;
        body.as_user = true;
        req.form = body;
    }
    else {
        body.username = event.user_id;
        req.body = body;
        req.json = true;
    }
    req.uri = hookURL;
    this.requestLib(req, function(err, res) {
        if (err) {
            console.log("HTTP Error: %s", err);
        }
        else {
            console.log("HTTP %s", res.statusCode);
        }
    });
};

module.exports = MatrixHandler;
