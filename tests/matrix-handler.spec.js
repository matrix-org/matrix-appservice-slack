"use strict";

var MatrixHandler = require("../lib/matrix-handler");

function makeEvent(message) {
    return {
        type: "m.room.message",
        room_id: "!foo:bar.baz",
        content: {
            body: message
        },
        user_id: "@michael:banana.stand"
    };
}

function requestLibObjFor(message) {
    return {
        method: "POST",
        json: true,
        uri: "https://hooks.slack.com/services/AAA/BBB/CCC",
        body: {
            username: "@michael:banana.stand",
            text: message
        }
    }
}

describe("MatrixHandler.handle", function() {
    var handler;
    var requestLib;

    beforeEach(function() {
        requestLib = createSpyObj("requestLib", ["do"]);
        var rooms = {
            webhookForMatrixRoomID: function(matrix_room_id) {
                return "https://hooks.slack.com/services/AAA/BBB/CCC";
            }
        };
        handler = new MatrixHandler(rooms, requestLib.do);
    });

    describe("handle text messages", function() {
        it("sends text messages", function() {
            var content = "Has anyone in this family ever seen a chicken?";
            var event = makeEvent(content);
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor(content),
                jasmine.any(Function)
            );
        });
        it("escapes special characters", function() {
            var event = makeEvent("<special & characters>");
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor("&lt;special &amp; characters&gt;"),
                jasmine.any(Function)
            );
        });
    });

});
