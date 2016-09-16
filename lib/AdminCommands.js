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
            var matrix_room_ids = room.getMatrixRoomIds();

            var slack_channel_id = room.getSlackChannelId();
            var slack_channel_name = room.getSlackChannelName() || "UNKNOWN";

            if (name_filter && !name_filter.exec(slack_channel_name)) {
                return;
            }

            var slack = slack_channel_name + "(" + slack_channel_id + ")";

            var status = room.getStatus();
            if (status !== "ready") status = status.toUpperCase();

            found++;

            if (!matrix_room_ids.length) {
                respond(status + " " + slack + " unlinked");
            }
            else if (matrix_room_ids.length == 1) {
                respond(status + " " + slack + " -- " + matrix_room_ids[0]);
            }
            else {
                respond(status + " " + slack + " linked:");
                matrix_room_ids.forEach((id) => respond(" +- " + id));
            }
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
        respond("  Inbound ID: " + room.getInboundId() || "(legacy)");
        respond("  Slack Name: " + room.getSlackChannelName() || "PENDING");
        respond("  Slack ID: " + room.getSlackChannelId());
        respond("  Token: " + room.getSlackToken());
        respond("  Webhook URI: " + room.getSlackWebhookUri());

        var matrix_room_ids = room.getMatrixRoomIds();

        if (!matrix_room_ids.length) {
            respond("  No Matrix room IDs");
        }
        else if(matrix_room_ids.length === 1) {
            respond("  Matrix room ID: " + matrix_room_ids[0]);
        }
        else {
            respond("  Matrix room IDs:");
            matrix_room_ids.forEach((id) => respond("    " + id));
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
        "token|t": "Slack webhook token",
    },
    func: function(bridge, opts, args, respond) {
        return bridge.actionLink({
            matrix_room_id: opts.room,
            slack_channel_name: opts.channel,
            slack_channel_id: opts.channel_id,
            slack_token: opts.token,
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
        if (!opts.channel && !opts.channel_id) {
            return Promise.reject("Require either --channel or --channel_id");
        }

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
