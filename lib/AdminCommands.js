"use strict";
const log = require("matrix-appservice-bridge").Logging.get("AdminCommands");
var Promise = require('bluebird');

var AdminCommand = require("./AdminCommand");

var adminCommands = {};

function quotemeta(s) { return s.replace(/\W/g, '\\$&'); }

adminCommands.help = AdminCommand.makeHelpCommand(adminCommands);

adminCommands.list = new AdminCommand({
    desc: "list the linked rooms",
    opts: {
        team: {
            description: "Filter only rooms for this Slack team domain",
            aliases: ['T'],
        },
        room: {
            description: "Filter only Matrix room IDs containing this string fragment",
            aliases: ['R'],
        },
    },
    func: function(main, opts, args, respond) {
        var name_filter;

        if (opts.team) {
            name_filter = new RegExp("^" + quotemeta(opts.team) + "\.#");
        }

        var found = 0;
        main._rooms.forEach((room) => {
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
        channel_id: {
            "channel_id|I": "Slack channel ID",
            aliases: ['I'],
        },
        channel: {
            description: "Slack channel name",
            aliases: ['C'],
        },
        room: {
            description: "Matrix room ID",
            aliases: ['R'],
        },
    },
    func: function(main, opts, args, respond) {
        log.debug("opts are", opts);
        log.debug("opts keys are", Object.keys(opts));

        if (Object.keys(opts).length != 1) {
            return Promise.reject("Require exactly one of --room, --channel or --channel_id");
        }

        var room = (opts.channel_id) ? main.getRoomBySlackChannelId(opts.channel_id) :
                   (opts.channel) ? main.getRoomBySlackChannelName(opts.channel) :
                   main.getRoomByMatrixRoomId(opts.room);

        if (!room) {
            respond("No such room");
            return;
        }

        respond("Bridged Room:");
        respond("  Status: " + room.getStatus());
        respond("  Slack Name: " + room.getSlackChannelName() || "PENDING");
        respond("  Webhook URI: " + room.getSlackWebhookUri());
        respond("  Inbound ID: " + room.getInboundId());
        respond("  Inbound URL: " + main.getInboundUrlForRoom(room));
        respond("  Matrix room ID: " + room.getMatrixRoomId());

        var oauth2 = main.getOAuth2();
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
        channel_id: {
            description: "Slack channel ID",
            aliases: ['I'],
        },
        channel: {
            description: "Slack channel name",
            aliases: ['C'],
        },
        room: {
            description: "Matrix room ID",
            aliases: ['R'],
            required: true,
        },
        webhook_url: {
            description: "Slack webhook URL. Used with Slack outgoing hooks integration",
            aliases: ['u'],
        },
        slack_bot_token: {
            description: "Slack bot user token. Used with Slack bot user & Events api",
            aliases: ['t'],
        },
        slack_user_token: {
            description: "Slack user token. Used to bridge files",
        }
    },
    func: function(main, opts, args, respond) {
        return main.actionLink({
            matrix_room_id: opts.room,
            slack_channel_name: opts.channel,
            slack_channel_id: opts.channel_id,
            slack_webhook_uri: opts.webhook_url,
            slack_bot_token: opts.slack_bot_token,
            slack_user_token: opts.slack_user_token,
        }).then(
            (room) => {
                respond("Room is now " + room.getStatus());
                if (room.getSlackWebhookUri()) {
                    respond("Inbound URL is " + main.getInboundUrlForRoom(room));
                }
            },
            (e) => { respond("Cannot link - " + e ) }
        );
    },
});

adminCommands.unlink = new AdminCommand({
    desc: "disconnect a linked Matrix and Slack room",
    opts: {
        channel_id: {
            description: "Slack channel ID",
            aliases: ['I'],
        },
        channel: {
            description: "Slack channel name",
            aliases: ['C'],
        },
        room: {
            description: "Matrix room ID",
            aliases: ['R'],
            required: true,
        },
    },
    func: function(main, opts, args, respond) {
        return main.actionUnlink({
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
    opts: {
        room: {
            description: "Matrix room ID",
            aliases: ['R'],
        },
    },
    args: ["room"],
    func: function(main, opts, args, respond) {
        return main.getBotIntent().join(opts.room).then(() => {
            respond("Joined");
        });
    },
});

adminCommands.leave = new AdminCommand({
    desc: "leave an unlinked room",
    opts: {
        room: {
            description: "Matrix room ID",
            aliases: ['R'],
        },
    },
    args: ["room"],
    func: function(main, opts, args, respond) {
        var roomId = opts.room;

        return main.listGhostUsers(roomId).then((user_ids) => {
            respond("Draining " + user_ids.length + " ghosts from " + roomId);

            return Promise.each(user_ids, (user_id) => {
                return main._bridge.getIntent(user_id).leave(roomId);
            });
        }).then(() => {
            return main.getBotIntent().leave(roomId);
        }).then(() => {
            respond("Drained");
        });
    },
});

adminCommands.stalerooms = new AdminCommand({
    desc: "list rooms the bot user is a member of that are unlinked",
    func: function(main, opts, args, respond) {
        return main.listRoomsFor().then((room_ids) => {
            room_ids.forEach((id) => {
                if (id === main._config.matrix_admin_room) return;
                if (main.getRoomByMatrixRoomId(id)) return;

                respond(id);
            });
        });
    },
});

module.exports = adminCommands;
