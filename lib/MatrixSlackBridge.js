"use strict";

var Promise = require('bluebird');

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;
var StateLookup = bridgeLib.StateLookup;

var SlackHookHandler = require("./SlackHookHandler");
var BridgedRoom = require("./BridgedRoom");
var SlackGhost = require("./SlackGhost");

var AdminCommands = require("./AdminCommands");
var Metrics = require("./Metrics");
var Provisioning = require("./Provisioning");

var randomstring = require("randomstring");

// TODO(paul): monkeypatch
StateLookup.prototype.untrackRoom = StateLookup.prototype.untrackRoom ||
    function(roomId) {
        delete this._dict[roomId];
    };

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

    // TODO(paul): ugh. this.getBotIntent() doesn't work before .run time
    // So we can't create the StateLookup instance yet
    this._stateStorage = null;

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
                self._stateStorage.onEvent(ev);
                self.onMatrixEvent(ev);
            },
        }
    });

    this._slackHookHandler = new SlackHookHandler(this);

    if (config.enable_metrics) {
        var metrics = this._metrics = new Metrics();

        metrics.addGauge({
            name: "rooms",
            help: "current count of mapped rooms",
            refresh: (gauge) => {
                gauge.set({side: "remote"},
                    Object.keys(this._roomsByInboundId).length);
                gauge.set({side: "matrix"},
                    Object.keys(this._roomsByMatrixRoomId).length);
            }
        });

        metrics.addGauge({
            name: "users",
            help: "current count of mapped users",
            refresh: (gauge) => {
                gauge.set({side: "remote"}, 0);
                gauge.set({side: "matrix"}, 0);
            }
        });

        metrics.addGauge({
            name: "ghosts",
            help: "current count of ghosted users",
            refresh: (gauge) => {
                gauge.set({side: "remote"}, 0);
                gauge.set({side: "matrix"},
                    Object.keys(this._ghostsByUserId).length);
            }
        });

        metrics.addCounter({
            name: "received_messages",
            help: "count of received messages",
        });
        metrics.addCounter({
            name: "dropped_messages",
            help: "count of received messages that are subsequently dropped",
        });
        metrics.addCounter({
            name: "sent_messages",
            help: "count of sent messages",
        });
        metrics.addCounter({
            name: "api_calls",
            help: "count of API calls made",
        });
    }
}

MatrixSlackBridge.prototype.incCounter = function(name, labels) {
    if (!this._metrics) return;
    this._metrics.incCounter(name, labels);
};

MatrixSlackBridge.prototype.incMatrixCallCounter = function(type) {
    if (!this._metrics) return;
    this._metrics.incCounter("api_calls", {side: "matrix", type: type});
};

MatrixSlackBridge.prototype.incRemoteCallCounter = function(type) {
    if (!this._metrics) return;
    this._metrics.incCounter("api_calls", {side: "remote", type: type});
};

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

MatrixSlackBridge.prototype.putUserToStore = function(user) {
    var entry = user.toEntry();
    return this.getUserStore().upsert({id: entry.id}, entry);
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

    var store = this.getUserStore();
    return store.select({id: user_id}).then((entries) => {
        var ghost;
        if (entries.length) {
            ghost = SlackGhost.fromEntry(this, entries[0], intent);
        }
        else {
            ghost = new SlackGhost({
                bridge: this,

                user_id: user_id,
                intent: intent,
            });
            this.putUserToStore(ghost);
        }

        this._ghostsByUserId[user_id] = ghost;
        return ghost;
    });
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

MatrixSlackBridge.prototype.getRoomByMatrixRoomId = function(room_id) {
    return this._roomsByMatrixRoomId[room_id];
};

MatrixSlackBridge.prototype.getRoomByInboundId = function(inbound_id) {
    return this._roomsByInboundId[inbound_id];
};

MatrixSlackBridge.prototype.getInboundUrlForRoom = function(room) {
    return this._config.inbound_uri_prefix + room.getInboundId();
};

// synchronous direct return from stored state, or null
MatrixSlackBridge.prototype.getStoredEvent = function(roomId, eventType, stateKey) {
    return this._stateStorage.getState(roomId, eventType, stateKey);
};

// asynchronous lookup using the botIntent client if stored state doesn't have
// it
MatrixSlackBridge.prototype.getState = function(roomId, eventType) {
    //   TODO: handle state_key. Has different return shape in the two cases
    var cached_event = this.getStoredEvent(roomId, eventType);
    if (cached_event && cached_event.length) {
        // StateLookup returns entire state events. client.getStateEvent returns
        //   *just the content*
        return Promise.resolve(cached_event[0].content);
    }

    return this.getBotIntent().client.getStateEvent(roomId, eventType);
};

MatrixSlackBridge.prototype.listAllUsers = function(roomId) {
    var botIntent = this.getBotIntent();
    return botIntent.roomState(roomId).then((events) => {
        // Filter for m.room.member with membership="join"
        events = events.filter(
            (ev) => ev.type === "m.room.member" && ev.membership === "join"
        );

        return events.map((ev) => ev.state_key);
    });
};

MatrixSlackBridge.prototype.listGhostUsers = function(roomId) {
    return this.listAllUsers(roomId).then((user_ids) => {
        // Filter for only those users matching the prefix
        var regexp = new RegExp("^@" + this._config.username_prefix);
        return user_ids.filter((id) => id.match(regexp));
    });
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

    this.incCounter("received_messages", {side: "matrix"});

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
        this.incCounter("dropped_messages", {side: "matrix"});
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

    if (!room) {
        var inbound_id = this.genInboundId();

        room = new BridgedRoom(this, {
            inbound_id: inbound_id,
            matrix_room_id: matrix_room_id,
        });
        this.addBridgedRoom(room);
        this._roomsByMatrixRoomId[matrix_room_id] = room;
        this._stateStorage.trackRoom(matrix_room_id);
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
    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);
    if (!room) {
        return Promise.reject("Cannot unlink - unknown channel");
    }

    this.removeBridgedRoom(room);
    delete this._roomsByMatrixRoomId[matrix_room_id];
    this._stateStorage.trackRoom(matrix_room_id);

    var id = room.toEntry().id;
    return this.getRoomStore().delete({id: id});
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
            console.log("Ignoring LEGACY room entry in room-store.db", entry);
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
                this._stateStorage.trackRoom(entry.matrix_id);
            }
            else {
                console.log("Ignoring LEGACY room link entry", entry);
            }
        });
    }).finally(() => {
        // Send process stats again just to make the counters update sooner after
        // startup
        if (this._metrics) this._metrics.refresh();
    });

    this._slackHookHandler.startAndListen(
        config.slack_hook_port, config.tls
    ).then(() => {
        bridge.run(port, config);
        Provisioning.addAppServicePath(bridge, this);

        // TODO(paul): see above; we had to defer this until now
        this._stateStorage = new StateLookup({
            eventTypes: ["m.room.member", "m.room.power_levels"],
            client: bridge.getIntent().client,
        });

        if (this._metrics) {
            this._metrics.addAppServicePath(bridge);
        }
    });
}

// Code below is the "provisioning"; the commands available over the
// Provisioning API

MatrixSlackBridge.prototype.checkLinkPermission = function(matrix_room_id, user_id) {
    // We decide to allow a user to link or unlink, if they have a powerlevel
    //   sufficient to affect the 'm.room.power_levels' state; i.e. the
    //   "operator" heuristic.
    return this.getState(matrix_room_id, "m.room.power_levels").then((levels) => {
        var user_level =
            (levels.users && user_id in levels.users) ? levels.users[user_id] :
                levels.users_default;

        var requires_level =
            (levels.events && "m.room.power_levels" in levels.events) ? levels.events["m.room.power_levels"] :
            ("state_default" in levels) ? levels.state_default :
                50;

        return user_level >= requires_level;
    });
};

Provisioning.commands.getbotid = new Provisioning.Command({
    params: [],
    func: function(bridge, req, res) {
        res.json({bot_user_id: bridge._bridge.getBot().getUserId()});
    }
});

Provisioning.commands.getlink = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: function(bridge, req, res, matrix_room_id, user_id) {
        var room = bridge.getRoomByMatrixRoomId(matrix_room_id);
        if (!room) {
            res.status(404).json({error: "Link not found"});
            return;
        }

        console.log("Need to enquire if " + user_id + " is allowed to link " + matrix_room_id);

        return bridge.checkLinkPermission(matrix_room_id, user_id).then((allowed) => {
            if (!allowed) return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id
            });
        }).then(
            () => {
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
        );
    }
});

Provisioning.commands.link = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: function(bridge, req, res, matrix_room_id, user_id) {
        console.log("Need to enquire if " + user_id + " is allowed to link " + matrix_room_id);

        var params = req.body;
        var opts = {
            matrix_room_id: matrix_room_id,
        };

        opts.slack_webhook_uri = params.slack_webhook_uri;

        return bridge.checkLinkPermission(matrix_room_id, user_id).then((allowed) => {
            if (!allowed) return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id,
            });

            return bridge.actionLink(opts);
        }).then(
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
            }
        );
    }
});

Provisioning.commands.unlink = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: function(bridge, req, res, matrix_room_id, user_id) {
        console.log("Need to enquire if " + user_id + " is allowed to link " + matrix_room_id);

        return bridge.checkLinkPermission(matrix_room_id, user_id).then((allowed) => {
            if (!allowed) return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id,
            });

            return bridge.actionUnlink({matrix_room_id: matrix_room_id});
        }).then(
            ()    => { res.json({}); }
        );
    }
});

module.exports = MatrixSlackBridge;
