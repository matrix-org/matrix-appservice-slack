"use strict";

var newYargs = function() {
    return require("yargs");
};

function AdminCommand(opts) {
    this._desc = opts.desc;
    this._func = opts.func;

    if (opts.yargs) {
        this._yargs = opts.yargs;
    }
}

AdminCommand.prototype.run = function(bridge, args, respond) {
    if (this._yargs) {
        var opts = this._yargs
            .fail(respond)
            .parse(args);
        if (opts) {
            this._func(bridge, opts, opts._, respond);
        }
    }
    else {
        this._func(bridge, args, respond);
    }
};

var adminCommands = {};

adminCommands.help = new AdminCommand({
    desc: "display a list of commands",
    func: function(bridge, args, respond) {
        // TODO(paul): more detailed help on a single command
        Object.keys(adminCommands).sort().forEach(function (k) {
            var cmd = adminCommands[k];
            respond(k + ": " + cmd._desc);
        });
    },
});

adminCommands.list = new AdminCommand({
    desc: "list the linked rooms",
    func: function(bridge, args, respond) {
        bridge._rooms.forEach((room) => {
            respond("-c=" + room.slack_channel_id + " -r=" + room.matrix_room_id);
        });
    },
});

adminCommands.link = new AdminCommand({
    desc: "connect a Matrix and a Slack room together",
    yargs: newYargs()
        .option("channel",
                {alias: "c", required: true})
        .option("room",
                {alias: "r", required: true})
        .option("webhook_url",
                {alias: "u", required: true})
        .option("token",
                {alias: "t", required: true}),
    func: function(bridge, opts, args, respond) {
        bridge.actionLink({
            matrix_room_id: opts.room,
            slack_channel_id: opts.channel,
            slack_token: opts.token,
            slack_webhook_uri: opts.webhook_url,
        });
    },
});

module.exports = adminCommands;
