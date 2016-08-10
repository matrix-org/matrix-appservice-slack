/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping
"use strict";

function Provisioner (bridge, rooms, enabled) {
    this._bridge = bridge;
    this._rooms = rooms;

    if (enabled) {
        console.log("Starting provisioning...");
    }
    else {
        console.log("Provisioning disabled.");
    }

    var appService = this._bridge.appService;
    var self = this;

    if (enabled && !(appService.app.use && appService.app.get && appService.app.post)) {
        throw new Error('Could not start provisioning API');
    }

    // Disable all provision endpoints by not calling 'next', returning an error
    if (!enabled) {
        appService.app.use(function(req, res, next) {
            if (self.isProvisionRequest(req)) {
                res.status(500);
                res.json({error : 'Provisioning is not enabled.'});
            }
            else {
                next();
            }
        });
    }

    // Deal with CORS (temporarily for s-web)
    appService.app.use(function(req, res, next) {
        if (self.isProvisionRequest(req)) {
                res.header("Access-Control-Allow-Origin", "*");
                res.header("Access-Control-Allow-Headers",
                    "Origin, X-Requested-With, Content-Type, Accept");
        }
        next();
    });

    appService.app.post("/_matrix/provision/link", function(req, res) {
        try {
            //link
            self.link(req.body);

            res.json({});
        }
        catch (err) {
            res.status(500).json({error: err.message});
            throw err;
        }
    });

    appService.app.post("/_matrix/provision/unlink", function(req, res) {
        try {
            //unlink
            self.unlink(req.body);
            res.json({});
        }
        catch (err) {
            res.status(500).json({error: err.message});
            throw err;
        }
    });

    appService.app.get("/_matrix/provision/listlinks/:roomId", function(req, res) {
        try {
            //list
            var list = self.listings(req.params.roomId);
            res.json(list);
        }
        catch (err) {
            res.status(500).json({error: err.message});
            throw err;
        }
    });

    if (enabled) {
        console.log("Provisioning started");
    }
}

Provisioner.prototype.isProvisionRequest = function(req) {
    return req.url === '/_matrix/provision/unlink' ||
            req.url === '/_matrix/provision/link'||
            req.url.match(/^\/_matrix\/provision\/listlinks/)
};

var parameterValidation = {
    slack_channel_id :
        {regex : /^[A-Z0-9]+$/, example : 'C0234V346'},
    slack_api_token :
        {regex : /^.+$/, example : 'dfsdfsdfsdfsdfsdfsdfsdf'},
    matrix_room_id :
        {regex : /^!.*:.*$/, example : '!Abcdefg:example.com[:8080]'},
    webhook_url :
        {regex : /^.+$/, example : 'http://webhooks.com/captainhook'},
};

Provisioner.prototype._validate = function(actual, parameterName) {
    var valid = parameterValidation[parameterName];

    if (!valid) {
        throw new Error(
            `Parameter name not recognised (${parameterName}).`
        );
    }

    if (!actual) {
        throw new Error(
            `${parameterName} not provided (like '${valid.example}').`
        );
    }

    if (typeof actual !== 'string') {
        throw new Error(
            `${parameterName} should be a string (like '${valid.example}').`
        );
    }

    if (!actual.match(valid.regex)) {
        throw new Error(
            `Malformed ${parameterName} ('${actual}'),` +
            ` should look like '${valid.example}'.`
        );
    }
};

// Validate parameters for use in linking/unlinking
Provisioner.prototype._validateAll = function(parameters, parameterNames) {
    for (var i = 0; i < parameterNames.length; i++) {
        this._validate(parameters[parameterNames[i]], parameterNames[i]);
    }
};

// Link a slack channel to a matrix room ID
Provisioner.prototype.link = function(options) {
    this._validateAll(options, [
        'slack_channel_id', 'slack_api_token',
        'matrix_room_id', 'webhook_url'
    ]);

    var slack_channel_id = options.slack_channel_id;
    var slack_api_token = options.slack_api_token;
    var matrix_room_id = options.matrix_room_id;
    var webhook_url = options.webhook_url;

    this._rooms.addRoom(slack_channel_id, slack_api_token, matrix_room_id, webhook_url);
};

// Unlink a slack channel from a matrix room ID
Provisioner.prototype.unlink = function(options) {
    this._validateAll(options, ['slack_channel_id', 'matrix_room_id']);

    var slack_channel_id = options.slack_channel_id;
    var matrix_room_id = options.matrix_room_id;

    this._rooms.removeRoom(slack_channel_id, matrix_room_id);
};

// List all mappings currently provisioned with the given matrix_room_id
Provisioner.prototype.listings = function(roomId) {
    this._validate(roomId, 'matrix_room_id');

    var room = this._rooms.matrix_rooms[roomId];

    if (!room) {
        return [];
    }

    return [room];
};

module.exports = {
    Provisioner : Provisioner
};
