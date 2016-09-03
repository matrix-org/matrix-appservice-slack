"use strict";

var minimist = require("minimist");

function AdminCommand(opts) {
    this._desc = opts.desc;
    this._func = opts.func;

    if (opts.opts) {
        this.optspec = {};
        this.optaliases = {};

        Object.keys(opts.opts).forEach((k) => {
            var names = k.split(/\|/);
            var name = names.shift();

            this.optspec[name] = {
                desc: opts.opts[k],
            }

            names.forEach((a) => this.optaliases[a] = name);
        });
    }
}

AdminCommand.prototype.run = function(bridge, args, respond) {
    if (this.optspec) {
        var opts = minimist(args);

        // Canonicalise aliases
        Object.keys(this.optaliases).forEach((a) => {
            if (a in opts) {
                opts[this.optaliases[a]] = opts[a];
                delete opts[a];
            }
        });

        Object.keys(opts).forEach((n) => {
            if (n === "_") return;

            if (!(n in this.optspec)) {
                throw Error("Unrecognised argument: " + n);
            }
        });

        var missing = [];
        Object.keys(this.optspec).sort().forEach((n) => {
            if (!(n in opts)) missing.push(n);
        });

        if (missing.length) {
            throw Error("Missing required arguments: " + missing.join(", "));
        }

        this._func(bridge, opts, opts._, respond);
    }
    else {
        this._func(bridge, args, respond);
    }
};

var adminCommands = {};

adminCommands.help = new AdminCommand({
    desc: "display a list of commands",
    func: function(bridge, args, respond) {
        if (args.length == 0) {
            Object.keys(adminCommands).sort().forEach(function (k) {
                var cmd = adminCommands[k];
                respond(k + ": " + cmd._desc);
            });
        }
        else {
            var name = args.shift();
            var cmd = adminCommands[name];
            if (!cmd) {
                throw Error("No such command '" + name + "'");
            }

            respond(name + " - " + cmd._desc);
            var optspec = cmd.optspec || {};
            Object.keys(optspec).sort().forEach((n) => {
                respond("  --" + n + ": " + optspec[n].desc);
            });
        }
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
    opts: {
        "channel|c": "Slack channel ID",
        "room|r": "Matrix room ID",
        "webhook_url|u": "Slack webhook URL",
        "token|t": "Slack webhook token",
    },
    func: function(bridge, opts, args, respond) {
        bridge.actionLink({
            matrix_room_id: opts.room,
            slack_channel_id: opts.channel,
            slack_token: opts.token,
            slack_webhook_uri: opts.webhook_url,
        }).then(
            ()  => { respond("Linked") },
            (e) => { respond("Cannot link - " + e ) }
        );
    },
});

adminCommands.unlink = new AdminCommand({
    desc: "disconnect a linked Matrix and Slack room",
    opts: {
        "channel|c": "Slack channel ID",
        "room|r": "Matrix room ID",
    },
    func: function(bridge, opts, args, respond) {
        bridge.actionUnlink({
            matrix_room_id: opts.room,
            slack_channel_id: opts.channel,
        }).then(
            ()  => { respond("Unlinked") },
            (e) => { respond("Cannot unlink - " + e) }
        );
    },
});

module.exports = adminCommands;
