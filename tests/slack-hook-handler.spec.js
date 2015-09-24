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
    var requestLib;
    var handler;
    var intent;
    var config;
    var timestamp = "1443017615.000193";

    function assertNoMessagesSent() {
        expect(intent.sendMessage).not.toHaveBeenCalled();
        expect(intent.sendText).not.toHaveBeenCalled();
    }

    beforeEach(function() {
        requestLib = {};
        config = {
            homeserver: {
                server_name: "foo.bar"
            },
            slack_master_token: "leavinganote"
        };
        var rooms = {
            knowsSlackChannel: function(channel_name) {
                return channel_name == "slackchan";
            },
            matrixRoomID: function(channel_name) {
                return channel_name == "slackchan" ? "!room:host" : null;
            }
        };
        intent = createSpyObj("intent", ["sendMessage", "sendText"]);
        var bridge = {
            getIntent: function() {
                return intent;
            }
        };
        handler = new SlackHookHandler(requestLib, config, rooms, bridge);
    });

    describe("handle text messages", function() {
        it("ignores slackbot", function() {
            handler.handle(makeRequest("USLACKBOT"));
            assertNoMessagesSent();
        });
        it("sends text messages", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("GOB", "I've made a huge mistake"));
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host", "I've made a huge mistake");

        });
        it("unescapes special characters", function() {
            handler.handle(makeRequest("GOB", "&lt;special &amp; characters&gt;"));
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host", "<special & characters>");
        });
        it("unicode-ifies one emojum", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("Lucille", ":wink:"));
            expect(intent.sendText).toHaveBeenCalledWith("!room:host", "😉");
        });
        it("unicode-ifies several emoji", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("Lucille", ":wink::wink: :rugby_football:"));
            expect(intent.sendText).toHaveBeenCalledWith("!room:host", "😉😉 🏉");
        });
        it("doesn't unicode-ifies emoji with whitespace", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("Lucille", ":win k:"));
            expect(intent.sendText).toHaveBeenCalledWith("!room:host", ":win k:");
        });
        it("doesn't unicode-ifies improperly formed emoji", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("Lucille", ":k:wink:"));
            expect(intent.sendText).toHaveBeenCalledWith("!room:host", ":k😉");
        });
        it("ignores unknown emoji", function() {
            intent = createSpyObj("intent", ["sendText"]);
            handler.handle(makeRequest("Lucille", ":godzillavodka:"));
            expect(intent.sendText).toHaveBeenCalledWith("!room:host", ":godzillavodka:");
        });
    });

    function mockChannelHistory(reply) {
        requestLib.post = function(url, params, cb) {
            expect(url).toEqual("https://slack.com/api/channels.history");
            expect(params).toEqual({form: {
                channel: "slackchan",
                latest: timestamp,
                oldest: timestamp,
                inclusive: "1",
                token: "leavinganote",
            }});
            cb(null, undefined, JSON.stringify(reply));
        };
    }

    function receiveImage() {
        handler.handle({
                "channel_id": "slackchan",
                "channel_name": "tantamount_studios",
                "timestamp": "1443017615.000193",
                "user_id": "MF",
                "user_name": "maeby"
        });
    }

    describe("handles image message", function() {
        it("ignores images if no master token set", function() {
            delete config.slack_master_token;
            requestLib = createSpyObj("requestLib", ["post"]);
            receiveImage();
            expect(requestLib.post).not.toHaveBeenCalled();
            assertNoMessagesSent();
        });
        it("sends image", function() {
            mockChannelHistory({
                ok: true,
                messages: [{
                    type: "message",
                    subtype: "file_share",
                    file: {
                        mimetype: "image/jpeg",
                        size: 123,
                        url: "http://almost.cousins/kissing.jpg",
                        title: "GM&M",
                        original_w: 1024,
                        original_h: 768
                    }
                }]
            });
            receiveImage();
            expect(intent.sendMessage).toHaveBeenCalledWith(
                "!room:host", {
                    msgtype: "m.image",
                    url: "http://almost.cousins/kissing.jpg",
                    body: "GM&M",
                    info: {
                        mimetype: "image/jpeg",
                        size: 123,
                        w: 1024,
                        h: 768
                    }
                }
            );
        });
        it("sends image with thumbnail", function() {
            mockChannelHistory({
                ok: true,
                messages: [{
                    type: "message",
                    subtype: "file_share",
                    file: {
                        mimetype: "image/jpeg",
                        size: 123,
                        url: "http://almost.cousins/kissing.jpg",
                        title: "GM&M",
                        original_w: 1024,
                        original_h: 768,
                        thumb_360: "http://almost.cousins/kissing_360.jpg",
                        thumb_360_w: 360,
                        thumb_360_h: 240
                    }
                }]
            });
            receiveImage();
            expect(intent.sendMessage).toHaveBeenCalledWith(
                "!room:host", {
                    msgtype: "m.image",
                    url: "http://almost.cousins/kissing.jpg",
                    thumbnail_url: "http://almost.cousins/kissing_360.jpg",
                    body: "GM&M",
                    info: {
                        mimetype: "image/jpeg",
                        size: 123,
                        w: 1024,
                        h: 768
                    },
                    thumbnail_info: {
                        w: 360,
                        h: 240
                    }
                }
            );
        });
        it("sends image with comment", function() {
            mockChannelHistory({
                ok: true,
                messages: [{
                    type: "message",
                    subtype: "file_share",
                    file: {
                        mimetype: "image/jpeg",
                        size: 123,
                        url: "http://almost.cousins/kissing.jpg",
                        title: "GM&M",
                        original_w: 1024,
                        original_h: 768,
                        initial_comment: {
                            comment: "&lt;It's only 63 minutes long&gt;"
                        }
                    }
                }]
            });
            receiveImage();
            expect(intent.sendMessage).toHaveBeenCalledWith(
                "!room:host", {
                    msgtype: "m.image",
                    url: "http://almost.cousins/kissing.jpg",
                    body: "GM&M",
                    info: {
                        mimetype: "image/jpeg",
                        size: 123,
                        w: 1024,
                        h: 768
                    }
                }
            );
            expect(intent.sendText).toHaveBeenCalledWith(
                "!room:host",
                "<It's only 63 minutes long>"
            );
        });
        it("ignores non-images", function() {
            mockChannelHistory({
                ok: true,
                messages: [{
                    type: "message",
                    subtype: "file_share",
                    file: {
                        mimetype: "application/monkeys",
                        size: 123,
                        url: "http://almost.cousins/kissing.jpg",
                        title: "GM&M",
                        original_w: 1024,
                        original_h: 768
                    }
                }]
            });
            assertNoMessagesSent();
        });
    });

});

describe("SlackHookHandler", function() {
    it("gets intent", function() {
        var requestLib = undefined;
        var config = {
            username_prefix: "prefix_",
            homeserver: {
                server_name: "my.homeserver"
            }
        };
        var rooms = undefined;
        var bridge = createSpyObj("bridge", ["getIntent"]);
        var handler = new SlackHookHandler(requestLib, config, rooms, bridge)
        handler.getIntent("foo");
        expect(bridge.getIntent).toHaveBeenCalledWith("@prefix_foo:my.homeserver");
    });
});
