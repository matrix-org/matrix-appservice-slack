"use strict";

var MatrixHandler = require("../lib/matrix-handler");

function makeTextEvent(message) {
    return makeEvent(message, "m.text", {});
}

function makeEvent(message, type, args) {
    var event = {
        type: "m.room.message",
        room_id: "!foo:bar.baz",
        content: {
            body: message,
            msgtype: type
        },
        user_id: "@michael:banana.stand"
    };
    for (var k in args) {
        event.content[k] = args[k];
    }
    return event;
}

function requestLibObjFor(args) {
    var obj = {
        method: "POST",
        json: true,
        uri: "https://hooks.slack.com/services/AAA/BBB/CCC",
        body: {
            username: "@michael:banana.stand"
        }
    };
    for (var k in args) {
        obj.body[k] = args[k];
    }
    return obj;
}

describe("MatrixHandler.handle", function() {
    var handler;
    var requestLib;
    var config = {
        homeserver: {
            url: "http://the.oc:92802"
        }
    };

    beforeEach(function() {
        requestLib = createSpyObj("requestLib", ["do"]);
        var rooms = {
            webhookForMatrixRoomID: function(matrix_room_id) {
                return "https://hooks.slack.com/services/AAA/BBB/CCC";
            }
        };
        handler = new MatrixHandler(config, rooms, requestLib.do);
    });

    describe("handle text messages", function() {
        it("sends text messages", function() {
            var content = "Has anyone in this family ever seen a chicken?";
            var event = makeTextEvent(content);
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor({text: content}),
                jasmine.any(Function)
            );
        });
        it("escapes special characters", function() {
            var event = makeTextEvent("<special & characters>");
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor({text: "&lt;special &amp; characters&gt;"}),
                jasmine.any(Function)
            );
        });
        it("escapes multiple of a special character", function() {
            var event = makeTextEvent("<<<<<");
            handler.handle(event);
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor({text: "&lt;&lt;&lt;&lt;&lt;"}),
                jasmine.any(Function)
            );
        });
    });
    describe("handle image messages", function() {
        it("handles images", function() {
            var event = makeEvent("There's always money", "m.image", {"url": "mxc://in.the/bananastand"});
            handler.handle(event)
            expect(requestLib.do).toHaveBeenCalledWith(
                requestLibObjFor({"attachments": [{
                    fallback: "There's always money",
                    image_url: "http://the.oc:92802/_matrix/media/v1/download/in.the/bananastand"
                }]}),
                jasmine.any(Function)
            );
        });
    });
});
