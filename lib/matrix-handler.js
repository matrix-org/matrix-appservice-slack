"use strict";

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
    room.onMatrixMessage(event);
};

module.exports = MatrixHandler;
