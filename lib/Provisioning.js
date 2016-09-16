"use strict";

var Promise = require("bluebird");

function Command(opts) {
    this._params = opts.params;
    this._func   = opts.func;
}

Command.prototype.run = function(service, req, res) {
    var body = req.body;

    var args = [service, req, res];
    for (var i = 0; i < this._params.length; i++) {
        var param = this._params[i];

        if(!(param in body)) {
            res.status(400).json({error: "Required parameter " + param + " missing"});
            return;
        }

        args.push(body[param]);
    }

    return this._func.apply(this, args);
};

var commands = {};

function handle(service, verb, req, res) {
    var prov = commands[verb];

    var p;
    if (prov) {
        p = Promise.try(() => {
            return prov.run(service, req, res);
        }).catch((e) => {
            console.log("Provisioning command failed:", e);
            res.status(500).json({error: "Provisioning command failed " + e});
        });
    }
    else {
        res.status(404).json({error: "Unrecognised provisioning command " + verb});
    }
};

function addAppServicePath(bridge, service) {
    bridge.addAppServicePath({
        method: "POST",
        path: "/_matrix/provision/:verb",
        handler: (req, res) => {
            var verb = req.params.verb;
            console.log("Received a _matrix/provision request for " + verb);
            handle(service, verb, req, res);
        }
    });
}

module.exports = {
    Command: Command,
    commands: commands,
    handle: handle,
    addAppServicePath: addAppServicePath,
};
