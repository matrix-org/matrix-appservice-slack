"use strict";

var Promise = require('bluebird');

var AdminCommand = require("./AdminCommand");

var adminCommands = {};

function quotemeta(s) { return s.replace(/\W/g, '\\$&'); }

adminCommands.help = AdminCommand.makeHelpCommand(adminCommands);

adminCommands.list = new AdminCommand({
    desc: "list the linked rooms",
    opts: {
        "team|T": "Filter only rooms for this Slack team domain",
    },
    func: function(bridge, opts, args, respond) {
        var name_filter;

        if (opts.team) {
            name_filter = new RegExp("^" + quotemeta(opts.team) + "\.#");
        }

        var found = 0;
        bridge._rooms.forEach((room) => {
            var matrix_room_id = room.getMatrixRoomId();
            var slack_channel_id = room.getSlackChannelId();
            var slack_channel_name = room.getSlackChannelName() || "UNKNOWN";

            if (name_filter && !name_filter.exec(slack_channel_name)) {
                return;
            }

            var slack = slack_channel_id ?
                slack_channel_name + "(" + slack_channel_id + ")" :
                slack_channel_name;

            var status = room.getStatus();
            if (!status.match(/^ready/)) status = status.toUpperCase();

            found++;

            respond(status + " " + slack + " -- " + matrix_room_id);
        });

        if (!found) {
            respond("No rooms found");
        }
    },
});

adminCommands.show = new AdminCommand({
    desc: "show a single connected room",
    opts: {
        "channel_id|I": "Slack channel ID",
        "channel|C": "Slack channel name",
        "room|R": "Matrix room ID",
    },
    func: function(bridge, opts, args, respond) {
        console.log("opts are", opts);
        console.log("opts keys are", Object.keys(opts));

        if (Object.keys(opts).length != 1) {
            return Promise.reject("Require exactly one of --room, --channel or --channel_id");
        }

        var room = (opts.channel_id) ? bridge.getRoomBySlackChannelId(opts.channel_id) :
                   (opts.channel) ? bridge.getRoomBySlackChannelName(opts.channel) :
                   bridge.getRoomByMatrixRoomId(opts.room);

        if (!room) {
            respond("No such room");
            return;
        }

        respond("Bridged Room:");
        respond("  Status: " + room.getStatus());
        respond("  Slack Name: " + room.getSlackChannelName() || "PENDING");
        respond("  Webhook URI: " + room.getSlackWebhookUri());
        respond("  Inbound ID: " + room.getInboundId());
        respond("  Inbound URL: " + bridge.getInboundUrlForRoom(room));
        respond("  Matrix room ID: " + room.getMatrixRoomId());

        var oauth2 = bridge.getOAuth2();
        if (oauth2) {
            var authorize_url = oauth2.makeAuthorizeURL({
                room: room,
                state: room.getInboundId(),
            });

            respond("  OAuth2 authorize URL: " + authorize_url);
        }
    },
});

adminCommands.link = new AdminCommand({
    desc: "connect a Matrix and a Slack room together",
    opts: {
        "channel_id|I": "Slack channel ID",
        "channel|C": "Slack channel name",
        "!room|R": "Matrix room ID",
        "webhook_url|u": "Slack webhook URL",
    },
    func: function(bridge, opts, args, respond) {
        return bridge.actionLink({
            matrix_room_id: opts.room,
            slack_channel_name: opts.channel,
            slack_channel_id: opts.channel_id,
            slack_webhook_uri: opts.webhook_url,
        }).then(
            (room) => {
                respond("Room is now " + room.getStatus());
                respond("Inbound URL is " + bridge.getInboundUrlForRoom(room));
            },
            (e) => { respond("Cannot link - " + e ) }
        );
    },
});

adminCommands.unlink = new AdminCommand({
    desc: "disconnect a linked Matrix and Slack room",
    opts: {
        "channel_id|I": "Slack channel ID",
        "channel|C": "Slack channel name",
        "!room|R": "Matrix room ID",
    },
    func: function(bridge, opts, args, respond) {
        return bridge.actionUnlink({
            matrix_room_id: opts.room,
            slack_channel_name: opts.channel,
            slack_channel_id: opts.channel_id,
        }).then(
            ()  => { respond("Unlinked") },
            (e) => { respond("Cannot unlink - " + e) }
        );
    },
});

module.exports = adminCommands;
