"use strict";

var minimist = require("minimist");

function AdminCommand(opts) {
    this.desc = opts.desc;
    this._func = opts.func;

    if (opts.opts) {
        this.optspec = {};
        this.optaliases = {};

        Object.keys(opts.opts).forEach((k) => {
            var names = k.split(/\|/);

            var result = names.shift().match(/^(\??)(.*$)/);
            var name = result[2];
            var required = !result[1];

            this.optspec[name] = {
                desc: opts.opts[k],
                required: required,
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
            if (this.optspec[n].required && !(n in opts)) missing.push(n);
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

AdminCommand.makeHelpCommand = function(commands) {
    return new AdminCommand({
        desc: "display a list of commands",
        func: function(bridge, args, respond) {
            if (args.length == 0) {
                Object.keys(commands).sort().forEach(function (k) {
                    var cmd = commands[k];
                    respond(k + ": " + cmd.desc);
                });
            }
            else {
                var name = args.shift();
                var cmd = commands[name];
                if (!cmd) {
                    throw Error("No such command '" + name + "'");
                }

                respond(name + " - " + cmd.desc);
                var optspec = cmd.optspec || {};
                Object.keys(optspec).sort().forEach((n) => {
                    respond("  --" + n + ": " + optspec[n].desc);
                });
            }
        },
    });
};

module.exports = AdminCommand;
