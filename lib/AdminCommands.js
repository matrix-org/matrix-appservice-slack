"use strict";

function AdminCommand(opts) {
    this._desc = opts.desc;
    this._func = opts.func;
}

AdminCommand.prototype.run = function(bridge, args, respond) {
    // TODO(paul): some introspection about required arguments, etc...
    this._func(bridge, args, respond);
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

module.exports = adminCommands;
