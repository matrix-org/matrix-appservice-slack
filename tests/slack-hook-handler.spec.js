"use strict";

var SlackHookHandler = require("../lib/slack-hook-handler");

function makeRequest(user, text) {
    return {
        "channel_id": "slackchan",
        "user_id": user,
        "text": text
    };
}

describe("SlackHookHandler.handle", function() {
    var handler;
    var intent;

    beforeEach(function() {
        var config = {
            homeserver: {
                server_name: "foo.bar"
            }
        };
        var rooms = {
            knowsSlackChannel: function(channel_name) {
                return channel_name == "slackchan";
            },
            matrixRoomID: function(channel_name) {
                return channel_name == "slackchan" ? "!room:host" : null;
            }
        };
        intent = {};
        var bridge = {
            getIntent: function() {
                return intent;
            }
        };
        handler = new SlackHookHandler(config, rooms, bridge);
    });

    describe("handle text messages", function() {
        it("ignores slackbot", function() {
            handler.handle(makeRequest("USLACKBOT"));
            // If any methods had been called on intent, we would have thrown.
        });
        it("sends text messages", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("GOB", "I've made a huge mistake"));
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host", "I've made a huge mistake");

        });
        it("unescapes special characters", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("GOB", "&lt;special &amp; characters&gt;"));
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host", "<special & characters>");
        });
        it("unicode-ifies emoji", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest(
                    "Lucille",
                    "nudge nudge:wink: :wink::rugby_football:wink :wink wink:"
                )
            );
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host",
                "nudge nudge😉 😉🏉wink :wink wink:"
            );
        });
    });

});

describe("SlackHookHandler", function() {
    it("gets intent", function() {
        var config = {
            username_prefix: "prefix_",
            homeserver: {
                server_name: "my.homeserver"
            }
        };
        var rooms = undefined;
        var bridge = createSpyObj("bridge", ["getIntent"]);
        var handler = new SlackHookHandler(config, rooms, bridge)
        handler.getIntent("foo");
        expect(bridge.getIntent).toHaveBeenCalledWith("@prefix_foo:my.homeserver");
    });
});
