"use strict";

var MatrixHandler = require("../lib/matrix-handler");

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
            var event = {
                type: "m.room.message",
                room_id: "!foo:bar.baz",
                content: {
                    body: "Has anyone in this family ever seen a chicken?"
                },
                user_id: "@michael:banana.stand"
            };
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith({
                method: "POST",
                json: true,
                uri: "https://hooks.slack.com/services/AAA/BBB/CCC",
                body: {
                    username: event.user_id,
                    text: event.content.body
                }
            }, jasmine.any(Function));
        });
    });

});
