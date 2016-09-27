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
        "room|R": "Filter only Matrix room IDs containing this string fragment",
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

            if (opts.room && matrix_room_id.indexOf(opts.room) === -1) {
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

adminCommands.join = new AdminCommand({
    desc: "join a new room",
    func: function(bridge, args, respond) {
        var roomId = args.shift();

        return bridge.getBotIntent().join(roomId).then(() => {
            respond("Joined");
        });
    },
});

adminCommands.leave = new AdminCommand({
    desc: "leave an unlinked room",
    func: function(bridge, args, respond) {
        var roomId = args.shift();

        return bridge.listGhostUsers(roomId).then((user_ids) => {
            respond("Draining " + user_ids.length + " ghosts from " + roomId);

            return Promise.each(user_ids, (user_id) => {
                return bridge._bridge.getIntent(user_id).leave(roomId);
            });
        }).then(() => {
            return bridge.getBotIntent().leave(roomId);
        }).then(() => {
            respond("Drained");
        });
    },
});

adminCommands.stalerooms = new AdminCommand({
    desc: "list rooms the bot user is a member of that are unlinked",
    func: function(bridge, args, respond) {
        return bridge.listRoomsFor().then((room_ids) => {
            room_ids.forEach((id) => {
                if (id === bridge._config.matrix_admin_room) return;
                if (bridge.getRoomByMatrixRoomId(id)) return;

                respond(id);
            });
        });
    },
});

module.exports = adminCommands;
