"use strict";

var Rooms = require("../lib/rooms");

describe("Rooms", function() {
    var rooms;

    beforeEach(function() {
        rooms = new Rooms({
            rooms: [{
                slack_channel_id: "ABCDEF",
                matrix_room_id: "!wifwfwg:matrix.org",
                webhook_url: "https://hooks.slack.com/services/AAA/BBB/CCC"
            }]
        });
    });

    describe("knowsSlackChannel", function() {
        it("should return room info for a known room", function() {
            expect(rooms.knowsSlackChannel("ABCDEF")).toBe(true);
        });
    });

});
