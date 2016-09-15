"use strict";

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;

var SlackHookHandler = require("./SlackHookHandler");
var BridgedRoom = require("./BridgedRoom");

var AdminCommands = require("./AdminCommands");

function MatrixSlackBridge(config) {
    var self = this;

    this._config = config;

    this._recentMatrixEventIds = new Array(20);
    this._mostRecentEventIdIdx = 0;

    this._rooms = [];
    this._roomsBySlackChannelId = {};
    this._roomsByMatrixRoomId = {};

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

MatrixSlackBridge.prototype.getIntentForSlackUsername = function(slackUser) {
    var username = "@" + this._config.username_prefix + slackUser +
        ":" + this._config.homeserver.server_name;
    return this._bridge.getIntent(username);
};

MatrixSlackBridge.prototype.addBridgedRoom = function(room) {
    this._rooms.push(room);
    this._roomsBySlackChannelId[room.getSlackChannelId()] = room;
};

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

MatrixSlackBridge.prototype.linkRoomToMatrix = function(room, matrix_room_id) {
    if (room.hasMatrixRoomId(matrix_room_id)) {
        return Promise.resolve();
    }

    room.addMatrixRoomId(matrix_room_id);
    this._roomsByMatrixRoomId[matrix_room_id] = room;

    var slack_channel_id = room.getSlackChannelId();
    var linkId = matrix_room_id + " " + slack_channel_id;

    return this.getRoomStore().insert({
        id: linkId,
        matrix_id: matrix_room_id,
        remote_id: slack_channel_id,
    }).then(() => {
        console.log("LINKED " + matrix_room_id + " to " + slack_channel_id);
    });
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
        try {
            p = c.run(this, args, respond);
        }
        catch (e) {
            respond("Command failed: " + e);
            p = Promise.resolve();
        }
    }
    else {
        respond("Unrecognised command: " + cmd);
        p = Promise.resolve();
    }

    (p || Promise.resolve()).then(() => {
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
//  * Create a BridgedRoom instance, with the given channel ID or channel name
//  * Associate a webhook_uri or authentication token to an existing instance
//  * Ensure that it is linked to the given matrix room ID
MatrixSlackBridge.prototype.actionLink = function(opts) {
    var matrix_room_id = opts.matrix_room_id;

    var _getOrMakeRoom = () => {
        var room = (opts.slack_channel_name) ?
            this.getRoomBySlackChannelName(opts.slack_channel_name) :
            this.getRoomBySlackChannelId(opts.slack_channel_id);

        if (room) return Promise.resolve(room);

        // TODO(paul): this line is the killer
        if (!opts.slack_channel_id) {
            throw new Error("TODO: need --channel-id");
        }

        room = new BridgedRoom(this, opts);

        return this.putRoomToStore(room).then(() => {
            this.addBridgedRoom(room);
            return room;
        });
    }
    return _getOrMakeRoom().then((room) => {
        if (opts.slack_token) {
            room.updateSlackToken(opts.slack_token);
        }

        if (opts.slack_webhook_uri) {
            room.updateSlackWebhookUri(opts.slack_webhook_uri);
        }

        if (room.isDirty()) {
            this.putRoomToStore(room);
        }

        return (matrix_room_id ? this.linkRoomToMatrix(room, matrix_room_id)
                               : Promise.resolve())
            .then(() => room);
    });
};

MatrixSlackBridge.prototype.actionUnlink = function(opts) {
    var room = (opts.slack_channel_name) ?
        this.getRoomBySlackChannelName(opts.slack_channel_name) :
        this.getRoomBySlackChannelId(opts.slack_channel_id);

    if (!room) {
        return Promise.reject("Cannot unlink - unknown channel");
    }

    var slack_channel_id = room.getSlackChannelId();
    var matrix_room_id = opts.matrix_room_id;

    return this.unlinkRoomFromMatrix(room, matrix_room_id).then((success) => {
        if (!success) {
            return Promise.reject("Cannot unlink - not linked to this room");
        }

        console.log("UNLINKED " + matrix_room_id + " from " + slack_channel_id);
    });
};

MatrixSlackBridge.prototype.run = function(port) {
    var bridge = this._bridge;
    var config = this._config;

    bridge.loadDatabases().then(() => {
        return this.getRoomStore().select({
            remote_id: {$exists: true},
            matrix_id: {$exists: false},
        })
    }).then((entries) => {
        entries.forEach((entry) => {
            var room = BridgedRoom.fromEntry(this, entry);
            this.addBridgedRoom(room);
        });
    }).then(() => {
        return this.getRoomStore().select({
            remote_id: {$exists: true},
            matrix_id: {$exists: true},
        });
    }).then((entries) => {
        entries.forEach((entry) => {
            var room = this.getRoomBySlackChannelId(entry.remote_id);
            if (room) {
                room.addMatrixRoomId(entry.matrix_id);
                this._roomsByMatrixRoomId[entry.matrix_id] = room;
            }
        });
    });

    this._slackHookHandler.startAndListen(
        config.slack_hook_port, config.tls
    ).then(() => {
        bridge.run(port, config);
    });
}

module.exports = MatrixSlackBridge;
