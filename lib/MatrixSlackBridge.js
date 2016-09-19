"use strict";

var Promise = require('bluebird');

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;

var SlackHookHandler = require("./SlackHookHandler");
var BridgedRoom = require("./BridgedRoom");
var SlackGhost = require("./SlackGhost");

var AdminCommands = require("./AdminCommands");
var Provisioning = require("./Provisioning");

var randomstring = require("randomstring");

function MatrixSlackBridge(config) {
    var self = this;

    this._config = config;

    this._recentMatrixEventIds = new Array(20);
    this._mostRecentEventIdIdx = 0;

    this._rooms = [];
    this._roomsBySlackChannelId = {};
    this._roomsByMatrixRoomId = {};
    this._roomsByInboundId = {};

    this._ghostsByUserId  = {};

    this._bridge = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.server_name,
        registration: "slack-registration.yaml",

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additonal data
            },

            onEvent: function(request, context) {
                var ev = request.getData();
                self.onMatrixEvent(ev);
            },
        }
    });

    this._slackHookHandler = new SlackHookHandler(this);
}

MatrixSlackBridge.prototype.getRoomStore = function() {
    return this._bridge.getRoomStore()
};

MatrixSlackBridge.prototype.putRoomToStore = function(room) {
    var entry = room.toEntry();
    return this.getRoomStore().upsert({id: entry.id}, entry);
};

MatrixSlackBridge.prototype.getUserStore = function() {
    return this._bridge.getUserStore();
};

MatrixSlackBridge.prototype.getUrlForMxc = function(mxc_url) {
    return this._config.homeserver.url + "/_matrix/media/v1/download/" +
        mxc_url.substring("mxc://".length);
};

MatrixSlackBridge.prototype.getTeamToken = function(team_domain) {
    // TODO(paul): move this into a mapping at least, if not full DB
    return this._config["slack_token_" + team_domain];
};

MatrixSlackBridge.prototype.getBotIntent = function() {
    return this._bridge.getIntent();
};

// Returns a Promise of a SlackGhost
MatrixSlackBridge.prototype.getGhostForSlackMessage = function(message) {
    // Slack ghost IDs need to be constructed from user IDs, not usernames,
    //   because users can change their names

    // TODO(paul): Steal MatrixIdTemplate from matrix-appservice-gitter
    var user_id = [
        "@", this._config.username_prefix, message.team_domain.toLowerCase(),
            "_", message.user_id.toUpperCase(), ":", this._config.homeserver.server_name
    ].join("");

    if (this._ghostsByUserId[user_id]) {
        return Promise.resolve(this._ghostsByUserId[user_id]);
    }

    var intent = this._bridge.getIntent(user_id);

    var ghost = new SlackGhost({intent: intent});

    this._ghostsByUserId[user_id] = ghost;
    return Promise.resolve(ghost);
};

// Generate a new random inbound ID that is known not to already be in use
MatrixSlackBridge.prototype.genInboundId = function() {
    var attempts = 10;
    while (attempts) {
        var id = randomstring.generate(32);
        if (!(id in this._roomsByInboundId)) return id;

        attempts--;
        if (!attempts) {
            // Prevent tightlooping if randomness goes odd
            throw new Error("Failed to generate a unique inbound ID after 10 attempts");
        }
    }
};

MatrixSlackBridge.prototype.addBridgedRoom = function(room) {
    this._rooms.push(room);

    var id = room.getSlackChannelId();
    if (id) this._roomsBySlackChannelId[id] = room;

    var inbound_id = room.getInboundId();
    if (inbound_id) this._roomsByInboundId[inbound_id] = room;
};

MatrixSlackBridge.prototype.removeBridgedRoom = function(room) {
    var id = room.getSlackChannelId();
    if (id) delete this._roomsBySlackChannelId[id];

    var inbound_id = room.getInboundId();
    if (inbound_id) delete this._roomsByInboundId[inbound_id];

    this._rooms = this._rooms.filter((r) => r !== room);
}

MatrixSlackBridge.prototype.getRoomBySlackChannelId = function(channel_id) {
    return this._roomsBySlackChannelId[channel_id];
};

MatrixSlackBridge.prototype.getRoomBySlackChannelName = function(channel_name) {
    // TODO(paul): this gets inefficient for long lists
    for(var i = 0; i < this._rooms.length; i++) {
        var room = this._rooms[i];
        if (room.getSlackChannelName() === channel_name) {
            return room;
        }
    }

    return null;
};

MatrixSlackBridge.prototype.unlinkRoomFromMatrix = function(room, matrix_room_id) {
    if (!room.removeMatrixRoomId(matrix_room_id)) return Promise.resolve(false);

    delete this._roomsByMatrixRoomId[matrix_room_id];

    var slack_channel_id = room.getSlackChannelId();
    var linkId = matrix_room_id + " " + slack_channel_id;
    return this.getRoomStore().delete({id: linkId}).then(() => {
        return true;
    });
};

MatrixSlackBridge.prototype.getRoomByMatrixRoomId = function(room_id) {
    return this._roomsByMatrixRoomId[room_id];
};

MatrixSlackBridge.prototype.getRoomByInboundId = function(inbound_id) {
    return this._roomsByInboundId[inbound_id];
};

MatrixSlackBridge.prototype.getInboundUrlForRoom = function(room) {
    return this._config.inbound_uri_prefix + room.getInboundId();
};

MatrixSlackBridge.prototype.onMatrixEvent = function(ev) {
    // simple de-dup
    var recents = this._recentMatrixEventIds;
    for (var i = 0; i < recents.length; i++) {
        if (recents[i] != undefined && recents[i] == ev.ev_id) {
          // move the most recent ev to where we found a dup and add the
          // duplicate at the end (reasoning: we only want one of the
          // duplicated ev_id in the list, but we want it at the end)
          recents[i] = recents[this._mostRecentEventIdIdx];
          recents[this._mostRecentEventIdIdx] = ev.ev_id;
          console.log("Ignoring duplicate ev: " + ev.ev_id);
          return;
        }
    }
    this._mostRecentEventIdIdx = (this._mostRecentEventIdIdx + 1) % 20;
    recents[this._mostRecentEventIdIdx] = ev.ev_id;

    var myUserId = this._bridge.getBot().getUserId();

    if (ev.type === "m.room.member" && ev.state_key === myUserId) {
        // A membership event about myself
        var membership = ev.content.membership;
        if (membership === "invite") {
            // Automatically accept all invitations
            this.getBotIntent().join(ev.room_id);
        }

        return;
    }

    if (ev.sender === myUserId) return;
    if (ev.type !== "m.room.message" || !ev.content) return;

    if (this._config.matrix_admin_room && ev.room_id === this._config.matrix_admin_room) {
        this.onMatrixAdminMessage(ev);
        return;
    }

    var room = this.getRoomByMatrixRoomId(ev.room_id);
    if (!room) {
        console.log("Ignoring ev for matrix room with unknown slack channel:" +
            ev.room_id);
        return;
    }
    room.onMatrixMessage(ev);
};

MatrixSlackBridge.prototype.onMatrixAdminMessage = function(ev) {
    var cmd = ev.content.body;

    // Ignore "# comment" lines as chatter between humans sharing the console
    if (cmd.match(/^\s*#/)) return;

    console.log("Admin: " + cmd);

    var response = [];
    function respond(message) {
        if (!response) {
            console.log("Command response too late: " + message);
            return;
        }
        response.push(message);
    };
    // Split the command string into optionally-quoted whitespace-separated
    //   tokens. The quoting preserves whitespace within quoted forms
    // TODO(paul): see if there's a "split like a shell does" function we can use
    //   here instead.
    var args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g);
    cmd = args.shift();

    var p;
    var c = AdminCommands[cmd];
    if (c) {
        p = Promise.try(() => {
            return c.run(this, args, respond);
        }).catch((e) => {
            respond("Command failed: " + e);
        });
    }
    else {
        respond("Unrecognised command: " + cmd);
        p = Promise.resolve();
    }

    p.then(() => {
        if (!response.length) response.push("Done");

        var message = (response.length == 1) ?
            ev.user_id + ": " + response[0] :
            ev.user_id + ":\n" + response.map((s) => "  " + s).join("\n");

        this.getBotIntent().sendText(ev.room_id, message);
        response = null;
    });
};

// This so-called "link" action is really a multi-function generic provisioning
// interface. It will
//  * Create a BridgedRoom instance, linked to the given Matrix room ID
//  * Associate a webhook_uri to an existing instance
MatrixSlackBridge.prototype.actionLink = function(opts) {
    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);
    if (room && room.isLegacy()) {
        return Promise.reject("Cannot link to an existing legacy-style room");
    }

    if (!room) {
        var inbound_id = this.genInboundId();

        room = new BridgedRoom(this, {
            inbound_id: inbound_id,
        });
        this.addBridgedRoom(room);

        room.addMatrixRoomId(matrix_room_id);
        this._roomsByMatrixRoomId[matrix_room_id] = room;
    }

    if (opts.slack_webhook_uri) {
        room.updateSlackWebhookUri(opts.slack_webhook_uri);
    }

    if (room.isDirty()) {
        this.putRoomToStore(room);
    }

    return Promise.resolve(room);
};

MatrixSlackBridge.prototype.actionUnlink = function(opts) {
    // For now, until all the legacy-style database entries are gone, we
    // need to support unlinking either new or old kinds of entry.

    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);
    if (!room) {
        return Promise.reject("Cannot unlink - unknown channel");
    }

    if (!room.isLegacy()) {
        // New-style - kill it entirely
        this.removeBridgedRoom(room);
        delete this._roomsByMatrixRoomId[matrix_room_id];

        var id = room.toEntry().id;
        return this.getRoomStore().delete({id: id});
    }
    else {
        // Legacy style - remove one Matrix room ID link
        return this.unlinkRoomFromMatrix(room, matrix_room_id).then((success) => {
            if (!success) {
                return Promise.reject("Cannot unlink - not linked to this room");
            }

            if (room.getMatrixRoomIds().length) return Promise.resolve();

            // Room is now entirely empty - remove it from the DB
            this.removeBridgedRoom(room);

            var id = room.toEntry().id;
            return this.getRoomStore().delete({id: id});
        });
    }
};

MatrixSlackBridge.prototype.actionUpgrade = function(opts) {
    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);
    if (!room.isLegacy()) {
        return Promise.reject("Cannot upgrade a non-legacy room");
    }

    if (room.getMatrixRoomIds().length != 1) {
        return Promise.reject("Can only upgrade rooms with exactly one Matrix room linked");
    }

    var store = this.getRoomStore();

    var old_id = room.toEntry().id;

    var slack_channel_id = room.getSlackChannelId();
    var old_link_id = slack_channel_id + " " + matrix_room_id;

    var inbound_id = this.genInboundId();
    room.updateInboundId(inbound_id);

    room._upgrade_pending = true;

    return Promise.all([
        this.putRoomToStore(room),
        store.delete({id: old_id}),
        store.delete({id: old_link_id}),
    ]).then(() => {
        this._roomsByInboundId[inbound_id] = room;
        return room;
    });
};

MatrixSlackBridge.prototype.run = function(port) {
    var bridge = this._bridge;
    var config = this._config;

    bridge.loadDatabases().then(() => {
        // Legacy-style BridgedRoom instances
        return this.getRoomStore().select({
            matrix_id: {$exists: false},
        })
    }).then((entries) => {
        entries.forEach((entry) => {
            var room = BridgedRoom.fromEntry(this, entry);
            this.addBridgedRoom(room);
        });
    }).then(() => {
        return this.getRoomStore().select({
            matrix_id: {$exists: true},
        });
    }).then((entries) => {
        entries.forEach((entry) => {
            // These might be links for legacy-style BridgedRooms, or new-style
            // rooms
            // Only way to tell is via the form of the id
            var result = entry.id.match(/^INTEG-(.*)$/);
            if (result) {
                var room = BridgedRoom.fromEntry(this, entry);
                this.addBridgedRoom(room);
                this._roomsByMatrixRoomId[entry.matrix_id] = room;
            }
            else {
                var room = this.getRoomBySlackChannelId(entry.remote_id);
                if (room) {
                    room.addMatrixRoomId(entry.matrix_id);
                    this._roomsByMatrixRoomId[entry.matrix_id] = room;
                }
            }
        });
    });

    this._slackHookHandler.startAndListen(
        config.slack_hook_port, config.tls
    ).then(() => {
        bridge.run(port, config);
        Provisioning.addAppServicePath(bridge, this);
    });
}

// Code below is the "provisioning"; the commands available over the
// Provisioning API

Provisioning.commands.getbotid = new Provisioning.Command({
    params: [],
    func: function(bridge, req, res) {
        res.json({bot_user_id: bridge._bridge.getBot().getUserId()});
    }
});

Provisioning.commands.getlink = new Provisioning.Command({
    params: ["matrix_room_id"],
    func: function(bridge, req, res, matrix_room_id) {
        var room = bridge.getRoomByMatrixRoomId(matrix_room_id);
        if (!room) {
            res.status(404).json({error: "Link not found"});
            return;
        }

        // Convert the room 'status' into a scalar 'status'
        var status = room.getStatus();
        if (status === "ready") {
            // OK
        }
        else if(status === "pending-params") {
            status = "partial";
        }
        else if(status === "pending-name") {
            status = "pending";
        }
        else {
            status = "unknown";
        }

        res.json({
            status: status,
            slack_channel_name: room.getSlackChannelName(),
            slack_webhook_uri: room.getSlackWebhookUri(),
            // This is slightly a lie
            matrix_room_id: matrix_room_id,
            inbound_uri: bridge.getInboundUrlForRoom(room),
        });
    }
});

Provisioning.commands.link = new Provisioning.Command({
    params: ["matrix_room_id"],
    func: function(bridge, req, res, matrix_room_id) {
        var params = req.body;
        var opts = {
            matrix_room_id: matrix_room_id,
        };

        opts.slack_webhook_uri = params.slack_webhook_uri;

        bridge.actionLink(opts).then(
            (room) => {
                // Convert the room 'status' into a scalar 'status'
                var status = room.getStatus();
                if (status === "ready") {
                    // OK
                }
                else if(status === "pending-params") {
                    status = "partial";
                }
                else if(status === "pending-name") {
                    status = "pending";
                }
                else {
                    status = "unknown";
                }

                res.json({
                    status: status,
                    slack_channel_name: room.getSlackChannelName(),
                    slack_webhook_uri: room.getSlackWebhookUri(),
                    matrix_room_id: matrix_room_id,
                    inbound_uri: bridge.getInboundUrlForRoom(room),
                });
            },
            (err) => { res.status(500).json({error: err}); }
        );
    }
});

Provisioning.commands.unlink = new Provisioning.Command({
    params: ["matrix_room_id"],
    func: function(bridge, req, res, matrix_room_id) {
        var params = req.body;
        var opts = {
            matrix_room_id: matrix_room_id,
        };

        bridge.actionUnlink(opts).then(
            ()    => { res.json({}); },
            (err) => { res.status(500).json({error: err}); }
        );
    }
});

module.exports = MatrixSlackBridge;
