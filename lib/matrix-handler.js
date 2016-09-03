"use strict";

var substitutions = require("./substitutions");
var rp = require('request-promise');

/**
 * @constructor
 * @param {Object} config the configuration of the bridge.
 *     See ../config/slack-config-schema.yaml for the schema to which this must conform.
 * @param {Bridge} bridge The containing Bridge instance
 */
function MatrixHandler(config, bridge) {
    this.config = config;
    this.bridge = bridge;
    this.recentEvents = new Array(20); // store last 20 event_ids
    this.mostRecentEvent = 0;
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
    // simple de-dup
    for (var i = 0; i < this.recentEvents.length; i++) {
        if (this.recentEvents[i] != undefined && this.recentEvents[i] == event.event_id) {
          // move the most recent event to where we found a dup and add the duplicate at the end 
          // (reasoning: we only want one of the duplicated event_id in the list, but we want it at the end)
          this.recentEvents[i] = this.recentEvents[this.mostRecentEvent];
          this.recentEvents[this.mostRecentEvent] = event.event_id;
          console.log("Ignoring duplicate event: " + event.event_id);
          return;
        }
    }
    this.mostRecentEvent = (this.mostRecentEvent + 1) % 20;
    this.recentEvents[this.mostRecentEvent] = event.event_id;

    if (event.type !== "m.room.message" || !event.content) {
        return;
    }
    var room = this.bridge.getRoomByMatrixRoomId(event.room_id);
    if (!room) {
        console.log("Ignoring event for matrix room with unknown slack channel:" +
            event.room_id);
        return;
    }
    var body = substitutions.matrixToSlack(event, this.config.homeserver);

    var sendMessageParams = {
        method: "POST",
        json: true,
        uri: room.slack_webhook_uri,
        body: body
    };

    var botIntent = this.bridge.getBotIntent();
    // TODO(paul): Expose getProfileInfo as a promisified method in bridge library
    botIntent.client.getProfileInfo(event.user_id, null, function(err, info) {
        if (!err && info.displayname) {
            sendMessageParams.body.username = info.displayname;
            console.log("found displayname: " + info.displayname);
        }
        if (!err && info.avatar_url && info.avatar_url.indexOf("mxc://") === 0) {
            console.log("found avatar_url: " + info.avatar_url);
            // TODO(paul): This should be my own homeserver, not matrix.org
            sendMessageParams.body.icon_url = "https://matrix.org/_matrix/media/v1/download/" + res.avatar_url.substring("mxc://".length);
        }

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
