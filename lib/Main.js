"use strict";

const Promise = require('bluebird');
const BridgeLib = require("matrix-appservice-bridge");
const Bridge = BridgeLib.Bridge;
const Metrics = BridgeLib.PrometheusMetrics;
const StateLookup = BridgeLib.StateLookup;
const SlackHookHandler = require("./SlackHookHandler");
const BridgedRoom = require("./BridgedRoom");
const SlackGhost = require("./SlackGhost");
const MatrixUser = require("./MatrixUser"); // NB: this is not BridgeLib.MatrixUser !
const AdminCommands = require("./AdminCommands");
const OAuth2 = require("./OAuth2");
const Provisioning = require("./Provisioning");
const randomstring = require("randomstring");
const log = require("matrix-appservice-bridge").Logging.get("Main");
const rp = require('request-promise');
const Datastore = require('nedb');
const path = require("path");

function Main(config) {
    var self = this;

    this._config = config;
    this._teams = new Map(); //team_id => team.

    if (config.oauth2) {
        this._oauth2 = new OAuth2({
            main: this,
            client_id: config.oauth2.client_id,
            client_secret: config.oauth2.client_secret,
            redirect_prefix: config.oauth2.redirect_prefix || config.inbound_uri_prefix,
        });
    }
    else {
        this._oauth2 = null;
    }

    this._recentMatrixEventIds = new Array(20);
    this._mostRecentEventIdIdx = 0;

    this._rooms = [];
    this._roomsBySlackChannelId = {};
    this._roomsBySlackTeamId = {};
    this._roomsByMatrixRoomId = {};
    this._roomsByInboundId = {};

    this._ghostsByUserId  = {};
    this._matrixUsersById = {};

    // TODO(paul): ugh. this.getBotIntent() doesn't work before .run time
    // So we can't create the StateLookup instance yet
    this._stateStorage = null;

    const dbdir = config.dbdir || "";
    this._bridge = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.server_name,
        registration: "slack-registration.yaml",
        userStore: path.join(dbdir, "user-store.db"),
        roomStore: path.join(dbdir, "room-store.db"),

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

    this._teamDatastore = null;

    this._slackHookHandler = new SlackHookHandler(this);

    if (config.enable_metrics) {
        this.initialiseMetrics();
    }
}

Main.prototype.initialiseMetrics = function() {
    var metrics = this._metrics = this._bridge.getPrometheusMetrics();

    this._bridge.registerBridgeGauges(() => {
        var now = Date.now() / 1000;

        var remote_rooms_by_age = new Metrics.AgeCounters();
        var matrix_rooms_by_age = new Metrics.AgeCounters();

        this._rooms.forEach((room) => {
            remote_rooms_by_age.bump(now - room.getRemoteATime());
            matrix_rooms_by_age.bump(now - room.getMatrixATime());
        });

        function count_ages(users) {
            var counts = new Metrics.AgeCounters();

            Object.keys(users).forEach((id) => {
                counts.bump(now - users[id].getATime());
            });

            return counts;
        }

        return {
            matrixRoomConfigs:
                Object.keys(this._roomsByMatrixRoomId).length,
            remoteRoomConfigs:
                Object.keys(this._roomsByInboundId).length,

            // As a relaybot we don't create remote-side ghosts
            remoteGhosts: 0,

            matrixRoomsByAge: matrix_rooms_by_age,
            remoteRoomsByAge: remote_rooms_by_age,

            matrixUsersByAge: count_ages(this._matrixUsersById),
            remoteUsersByAge: count_ages(this._ghostsByUserId),
        }
    });

    metrics.addCounter({
        name: "received_messages",
        help: "count of received messages",
        labels: ["side"],
    });
    metrics.addCounter({
        name: "sent_messages",
        help: "count of sent messages",
        labels: ["side"],
    });
    metrics.addCounter({
        name: "remote_api_calls",
        help: "Count of the number of remote API calls made",
        labels: ["method"],
    });

    metrics.addTimer({
        name: "matrix_request_seconds",
        help: "Histogram of processing durations of received Matrix messages",
        labels: ["outcome"],
    });
    metrics.addTimer({
        name: "remote_request_seconds",
        help: "Histogram of processing durations of received remote messages",
        labels: ["outcome"],
    });
};

Main.prototype.incCounter = function(name, labels) {
    if (!this._metrics) return;
    this._metrics.incCounter(name, labels);
};

Main.prototype.incRemoteCallCounter = function(type) {
    if (!this._metrics) return;
    this._metrics.incCounter("remote_api_calls", {method: type});
};

Main.prototype.startTimer = function(name, labels) {
    if (!this._metrics) return function() {};
    return this._metrics.startTimer(name, labels);
};

Main.prototype.getOAuth2 = function() {
    return this._oauth2;
};

Main.prototype.getRoomStore = function() {
    return this._bridge.getRoomStore()
};

Main.prototype.putRoomToStore = function(room) {
    var entry = room.toEntry();
    return this.getRoomStore().upsert({id: entry.id}, entry);
};

Main.prototype.getUserStore = function() {
    return this._bridge.getUserStore();
};

Main.prototype.putUserToStore = function(user) {
    var entry = user.toEntry();
    return this.getUserStore().upsert({id: entry.id}, entry);
};

Main.prototype.getUrlForMxc = function(mxc_url) {
    const hs = this._config.homeserver;
    return (hs.media_url || hs.url) + "/_matrix/media/r0/download/" +
        mxc_url.substring("mxc://".length);
};

Main.prototype.getBotIntent = function() {
    return this._bridge.getIntent();
};

Main.prototype.getUserIDPrefix = function() {
    return this._config.username_prefix;
};

Main.prototype.getTeamDomainForMessage = function(message) {
    if (message.team_domain) {
        return Promise.resolve(message.team_domain);
    }

    if (!message.team_id) {
        return Promise.reject("Cannot determine team, no id given.");
    }

    if (this._teams.has(message.team_id)) {
        return Promise.resolve(this._teams.get(message.team_id).domain);
    }

    const room = this.getRoomBySlackChannelId(message.channel);

    var channelsInfoApiParams = {
        uri: 'https://slack.com/api/team.info',
        qs: {
            token: room.getAccessToken()
        },
        json: true
    };
    this.incRemoteCallCounter("team.info");
    return rp(channelsInfoApiParams).then((response) => {
        if (!response.ok) {
            log.error(`Trying to fetch the ${message.team_id} team.`, response);
            return Promise.resolve();
        }
        log.info("Got new team:", response);
        this._teams.set(message.team_id, response.team);
        return response.team.domain;
    });
}

Main.prototype.getUserId = function(id, team_domain) {
    return [
        "@", this._config.username_prefix, team_domain.toLowerCase(),
            "_", id.toUpperCase(), ":", this._config.homeserver.server_name
    ].join("");

}

// Returns a Promise of a SlackGhost
Main.prototype.getGhostForSlackMessage = function(message) {
    // Slack ghost IDs need to be constructed from user IDs, not usernames,
    // because users can change their names
    // TODO if the team_domain is changed, we will recreate all users.
    // TODO(paul): Steal MatrixIdTemplate from matrix-appservice-gitter

    // team_domain is gone, so we have to actually get the domain from a friendly object.
    return this.getTeamDomainForMessage(message).then((team_domain) => {
        const user_id = this.getUserId(
            message.user_id.toUpperCase(),
            team_domain.toLowerCase()
        );

        if (this._ghostsByUserId[user_id]) {
            return Promise.resolve(this._ghostsByUserId[user_id]);
        }

        const intent = this._bridge.getIntent(user_id);
        const store = this.getUserStore();

        return store.select({id: user_id}).then((entries) => {
            var ghost;
            if (entries.length) {
                ghost = SlackGhost.fromEntry(this, entries[0], intent);
            }
            else {
                ghost = new SlackGhost({
                    main: this,

                    user_id: user_id,
                    intent: intent,
                });
                this.putUserToStore(ghost);
            }

            this._ghostsByUserId[user_id] = ghost;
            return ghost;
        });
    });
};

Main.prototype.getOrCreateMatrixUser = function(id) {
    // This is currently a synchronous method but maybe one day it won't be
    var u = this._matrixUsersById[id];
    if (u) return Promise.resolve(u);

    u = this._matrixUsersById[id] = new MatrixUser(this, {user_id: id});
    return Promise.resolve(u);
};

// Generate a new random inbound ID that is known not to already be in use
Main.prototype.genInboundId = function() {
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

Main.prototype.addBridgedRoom = function(room) {
    this._rooms.push(room);

    var id = room.getSlackChannelId();
    if (id) this._roomsBySlackChannelId[id] = room;

    var inbound_id = room.getInboundId();
    if (inbound_id) this._roomsByInboundId[inbound_id] = room;

    var team_id = room.getSlackTeamId();
    if (team_id) {
        var rooms = this._roomsBySlackTeamId[team_id];
        if (!rooms) {
            this._roomsBySlackTeamId[team_id] = [ room ];
        }
        else {
            rooms.push(room);
        }
    }
};

Main.prototype.removeBridgedRoom = function(room) {
    var id = room.getSlackChannelId();
    if (id) delete this._roomsBySlackChannelId[id];

    var inbound_id = room.getInboundId();
    if (inbound_id) delete this._roomsByInboundId[inbound_id];

    this._rooms = this._rooms.filter((r) => r !== room);
}

Main.prototype.getRoomBySlackChannelId = function(channel_id) {
    return this._roomsBySlackChannelId[channel_id];
};

Main.prototype.getRoomsBySlackTeamId = function(team_id) {
    return this._roomsBySlackTeamId[team_id] || [];
};

Main.prototype.getRoomBySlackChannelName = function(channel_name) {
    // TODO(paul): this gets inefficient for long lists
    for(var i = 0; i < this._rooms.length; i++) {
        var room = this._rooms[i];
        if (room.getSlackChannelName() === channel_name) {
            return room;
        }
    }

    return null;
};

Main.prototype.getRoomByMatrixRoomId = function(room_id) {
    return this._roomsByMatrixRoomId[room_id];
};

Main.prototype.getRoomByInboundId = function(inbound_id) {
    return this._roomsByInboundId[inbound_id];
};

Main.prototype.getInboundUrlForRoom = function(room) {
    return this._config.inbound_uri_prefix + room.getInboundId();
};

// synchronous direct return from stored state, or null
Main.prototype.getStoredEvent = function(roomId, eventType, stateKey) {
    return this._stateStorage.getState(roomId, eventType, stateKey);
};

// asynchronous lookup using the botIntent client if stored state doesn't have
// it
Main.prototype.getState = function(roomId, eventType) {
    //   TODO: handle state_key. Has different return shape in the two cases
    var cached_event = this.getStoredEvent(roomId, eventType);
    if (cached_event && cached_event.length) {
        // StateLookup returns entire state events. client.getStateEvent returns
        //   *just the content*
        return Promise.resolve(cached_event[0].content);
    }

    return this.getBotIntent().client.getStateEvent(roomId, eventType);
};

Main.prototype.listAllUsers = function(roomId) {
    var botIntent = this.getBotIntent();
    return botIntent.roomState(roomId).then((events) => {
        // Filter for m.room.member with membership="join"
        events = events.filter(
            (ev) => ev.type === "m.room.member" && ev.membership === "join"
        );

        return events.map((ev) => ev.state_key);
    });
};

Main.prototype.listGhostUsers = function(roomId) {
    return this.listAllUsers(roomId).then((user_ids) => {
        // Filter for only those users matching the prefix
        var regexp = new RegExp("^@" + this._config.username_prefix);
        return user_ids.filter((id) => id.match(regexp));
    });
};

Main.prototype.drainAndLeaveMatrixRoom = function(roomId) {
    return this.listGhostUsers(roomId).then((user_ids) => {
        log.info("Draining " + user_ids.length + " ghosts from " + roomId);

        return Promise.each(user_ids, (user_id) => {
            return this._bridge.getIntent(user_id).leave(roomId);
        });
    }).then(() => {
        return this.getBotIntent().leave(roomId);
    });
};

// Returns a (Promise of a) list of Matrix room IDs the given intent user
// (or null to use the bridge's own intent object) has the membership state
// (or a default of "join") in
Main.prototype.listRoomsFor = function(intent, state) {
    if (!intent) intent = this.getBotIntent();
    if (state && state !== "join") {
        return Promise.reject("listRoomsFor only supports 'join'");
    }

    // This endpoint sucks because we can only get joined rooms.
    // Previously we filtered a /sync but obviously that was broken too.
    // -- Halfy
    // TODO: Replace with a call that gets invited rooms when one appears
    return intent.client._http.authedRequestWithPrefix(
        undefined, "GET", "/joined_rooms",
        undefined, undefined, "/_matrix/client/r0"
    ).then((data) => {
        return data.joined_rooms;
    });
};

Main.prototype.onMatrixEvent = function(ev) {
    // simple de-dup
    var recents = this._recentMatrixEventIds;
    for (var i = 0; i < recents.length; i++) {
        if (recents[i] != undefined && recents[i] == ev.ev_id) {
          // move the most recent ev to where we found a dup and add the
          // duplicate at the end (reasoning: we only want one of the
          // duplicated ev_id in the list, but we want it at the end)
          recents[i] = recents[this._mostRecentEventIdIdx];
          recents[this._mostRecentEventIdIdx] = ev.ev_id;
          log.warn("Ignoring duplicate ev: " + ev.ev_id);
          return;
        }
    }
    this._mostRecentEventIdIdx = (this._mostRecentEventIdIdx + 1) % 20;
    recents[this._mostRecentEventIdIdx] = ev.ev_id;

    this.incCounter("received_messages", {side: "matrix"});
    var endTimer = this.startTimer("matrix_request_seconds");

    var myUserId = this._bridge.getBot().getUserId();

    if (ev.type === "m.room.member" && ev.state_key === myUserId) {
        // A membership event about myself
        var membership = ev.content.membership;
        if (membership === "invite") {
            // Automatically accept all invitations
            // NOTE: This can race and fail if the invite goes down the AS stream
            // before the homeserver believes we can actually join the room.
            this.getBotIntent().join(ev.room_id);
        }

        endTimer({outcome: "success"});
        return;
    }

    if (ev.type === "m.room.member"
        && this._bridge.getBot()._isRemoteUser(ev.state_key)
        && ev.sender !== myUserId) {
        log.info(`${ev.state_key} got invite for ${ev.room_id} but we can't do DMs, warning room.`);
        const intent = this._bridge.getIntent(ev.state_key);
        intent.join(ev.room_id).then(() => {
            return intent.sendEvent(ev.room_id, "m.room.message", {
                msgtype: "m.notice",
                body: "The slack bridge doesn't support private messaging, or inviting to rooms.",
            });
        }).then(() => {
            return intent.leave(ev.room_id);
        }).catch((err) => {
            log.error("Couldn't send warning to user(s) about not supporting PMs", err);
        });
        endTimer({outcome: "success"});
        return;
    }

    if (ev.sender === myUserId || ev.type !== "m.room.message" || !ev.content) {
        endTimer({outcome: "success"});
        return;
    }

    if (this._config.matrix_admin_room && ev.room_id === this._config.matrix_admin_room) {
        this.onMatrixAdminMessage(ev).then(
            () => endTimer({outcome: "success"}),
            (e) => {
                log.error("Failed processing admin message: ", e);
                endTimer({outcome: "fail"});
            }
        );
        return;
    }

    var room = this.getRoomByMatrixRoomId(ev.room_id);
    if (!room) {
        log.warn("Ignoring ev for matrix room with unknown slack channel:" +
            ev.room_id);
        endTimer({outcome: "dropped"});
        return;
    }

    room.onMatrixMessage(ev).then(
        () => endTimer({outcome: "success"}),
        (e) => {
            log.error("Failed procesing matrix message: ", e);
            endTimer({outcome: "fail"});
        }
    );
};

Main.prototype.onMatrixAdminMessage = function(ev) {
    var cmd = ev.content.body;

    // Ignore "# comment" lines as chatter between humans sharing the console
    if (cmd.match(/^\s*#/)) return Promise.resolve();

    log.info("Admin: " + cmd);

    var response = [];
    function respond(message) {
        if (!response) {
            log.info("Command response too late: " + message);
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

    return p.then(() => {
        if (!response.length) response.push("Done");

        var message = (response.length == 1) ?
            ev.user_id + ": " + response[0] :
            ev.user_id + ":\n" + response.map((s) => "  " + s).join("\n");

        response = null;
        return this.getBotIntent().sendText(ev.room_id, message);
    });
};

// This so-called "link" action is really a multi-function generic provisioning
// interface. It will
//  * Create a BridgedRoom instance, linked to the given Matrix room ID
//  * Associate a webhook_uri to an existing instance
Main.prototype.actionLink = function(opts) {
    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);

    var isNew = false;
    if (!room) {
        var inbound_id = this.genInboundId();

        room = new BridgedRoom(this, {
            inbound_id: inbound_id,
            matrix_room_id: matrix_room_id,
        });
        isNew = true;
        this._roomsByMatrixRoomId[matrix_room_id] = room;
        this._stateStorage.trackRoom(matrix_room_id);
    }

    if (opts.slack_webhook_uri) {
        room.updateSlackWebhookUri(opts.slack_webhook_uri);
    }

    if (opts.slack_channel_id) {
        room.updateSlackChannelId(opts.slack_channel_id);
    }

    if (opts.slack_user_token) {
        room.updateSlackUserToken(opts.slack_user_token);
    }
    let teamPromise = Promise.resolve(opts.slack_bot_token);
    if (opts.team_id) {
        teamPromise = this.getTeamFromStore(opts.team_id).then((team) => {
            return team.bot_token;
        });
    }

    if (opts.slack_bot_token || opts.team_id) {
        return teamPromise.then((token) => {
            room.updateSlackBotToken(token);
            this.incRemoteCallCounter("channels.info");
            const fetchName = rp({
                url: "https://slack.com/api/channels.info",
                qs: {
                    token: token,
                    channel: opts.slack_channel_id,
                },
                json: true
            }).then((response) => {
                if (!response.ok) {
                    log.error(`channels.info for ${opts.slack_channel_id} errored:`, response);
                    return;
                }
                room.updateSlackChannelName(response.channel.name);
            });
            return Promise.all([
                room.refreshTeamInfo(),
                room.refreshUserInfo(),
                fetchName,
            ]);
        }).then(() => {
            if (isNew) this.addBridgedRoom(room);
            if (room.isDirty()) this.putRoomToStore(room);
            return room;
        });
    }

    if (isNew) this.addBridgedRoom(room);

    if (room.isDirty()) {
        this.putRoomToStore(room);
    }

    return Promise.resolve(room);
};

Main.prototype.actionUnlink = function(opts) {
    var matrix_room_id = opts.matrix_room_id;

    var room = this.getRoomByMatrixRoomId(matrix_room_id);
    if (!room) {
        return Promise.reject("Cannot unlink - unknown channel");
    }

    this.removeBridgedRoom(room);
    delete this._roomsByMatrixRoomId[matrix_room_id];
    this._stateStorage.untrackRoom(matrix_room_id);

    var id = room.toEntry().id;
    return this.drainAndLeaveMatrixRoom(matrix_room_id).then(() => {
        return this.getRoomStore().delete({id: id});
    });
};

Main.prototype.run = function(port) {
    var bridge = this._bridge;
    var config = this._config;

    bridge.loadDatabases().then(() => {
        log.info("Loading teams.db");
        this._teamDatastore = new Datastore({ filename: './teams.db', autoload: true });
        return new Promise((resolve, reject) => {
            this._teamDatastore.loadDatabase((err) => {
            if (err) {
                reject(err);
                return;
            };
            resolve();
        })});
    }).then(() => {
        // Legacy-style BridgedRoom instances
        return this.getRoomStore().select({
            matrix_id: {$exists: false},
        })
    }).then((entries) => {
        entries.forEach((entry) => {
            log.error("Ignoring LEGACY room entry in room-store.db", entry);
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
                log.error("Ignoring LEGACY room link entry", entry);
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

Main.prototype.checkLinkPermission = function(matrix_room_id, user_id) {
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

Main.prototype.setUserAccessToken = function(userId, team_id, slack_id, access_token) {
    const store = this._bridge.getUserStore();
    return store.getMatrixUser(userId).then((matrixUser) => {
        matrixUser = matrixUser ? matrixUser : new BridgeLib.MatrixUser(userId);
        const accounts = matrixUser.get("accounts") || {};
        accounts[slack_id] = {team_id, access_token};
        matrixUser.set("accounts", accounts);
        store.setMatrixUser(matrixUser);
        log.info(`Set new access token for ${userId} (team: ${team_id})`);
    });
};

Main.prototype.updateTeamBotStore = function(team_id, team_name, user_id, bot_token) {
    this._teamDatastore.update({team_id}, {
        team_id,
        team_name,
        bot_token,
        user_id,
    }, {upsert: true});
    log.info(`Setting details for team ${team_id} ${team_name}`);
}

Main.prototype.getTeamFromStore = function(team_id) {
    return new Promise((resolve, reject) => {
        this._teamDatastore.findOne({team_id: team_id}, (err, doc) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(doc);
        });
    });
}

Main.prototype.matrixUserInSlackTeam = function(team_id, user_id) {
    return this.getUserStore().getMatrixUser(user_id)
        .then((matrixUser) => {
            if(matrixUser === null) {
                return false;
            }
            const accounts = Object.values(matrixUser.get("accounts"));
            if (!accounts.find((acct) => acct.team_id === team_id)) {
                return false;
            }
            return true;
    });
}

Provisioning.commands.getbotid = new Provisioning.Command({
    params: [],
    func: function(main, req, res) {
        res.json({bot_user_id: main._bridge.getBot().getUserId()});
    }
});

Provisioning.commands.authurl = new Provisioning.Command({
    params: ["user_id"],
    func: function(main, req, res, user_id) {
        const oauth2 = main.getOAuth2();
        if (!oauth2) {
            res.status(400).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const token = oauth2.getPreauthToken(user_id);
        const auth_uri = oauth2.makeAuthorizeURL({
            room: token,
            state: token,
        });
        res.json({auth_uri});
    }
});

Provisioning.commands.logout = new Provisioning.Command({
    params: ["user_id", "slack_id"],
    func: function(main, req, res, user_id, slack_id) {
        const oauth2 = main.getOAuth2();
        if (!oauth2) {
            res.status(400).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const store = main._bridge.getUserStore();
        return store.getMatrixUser(user_id).then((matrixUser) => {
            matrixUser = matrixUser ? matrixUser : new BridgeLib.MatrixUser(userId);
            const accounts = matrixUser.get("accounts") || {};
            delete accounts[slack_id];
            matrixUser.set("accounts", accounts);
            store.setMatrixUser(matrixUser);
            log.info(`Removed accoun ${slack_id} from ${userId}`);
        });
    }
});

Provisioning.commands.channels = new Provisioning.Command({
    params: ["user_id", "team_id"],
    func: function(main, req, res, user_id, team_id) {
    const store = main._bridge.getUserStore();
        log.debug(`${user_id} requested their teams`);
        main.incRemoteCallCounter("conversations.list");
        return store.getMatrixUser(user_id).then((matrixUser) => {
            const isAllowed = matrixUser !== null &&
                Object.values(matrixUser.get("accounts")).find((acct) =>
                    acct.team_id === team_id
                );
            if (!isAllowed) {
                res.status(403).json({error: "User is not part of this team!"});
                return Promise.reject();
            }
            return main.getTeamFromStore(team_id);
        }).then((team) => {
            if (team === null) {
                throw new Error("No team token for this team_id");
            }
            return rp({
                url: "https://slack.com/api/conversations.list",
                qs: {
                    token: team.bot_token,
                    exclude_archived: true,
                    types: "public_channel",
                    limit: 100,
                },
                json: true
            });
        }).then((response) => {
            if (!response.ok) {
                log.error(`Failed trying to fetch channels for ${team_id}.`, response);
                res.status(500).json({error: "Failed to fetch channels"});
                return;
            }
            res.json({
                channels: response.channels.map((chan) => ({
                    id: chan.id,
                    name: chan.name,
                    topic: chan.topic,
                    purpose: chan.purpose,
                }))
            });
        });
    }
});

Provisioning.commands.teams = new Provisioning.Command({
    params: ["user_id"],
    func: function(main, req, res, user_id) {
        log.debug(`${user_id} requested their teams`);
        const store = main._bridge.getUserStore();
        let teams = [];
        return store.getMatrixUser(user_id).then((matrixUser) => {
            if(matrixUser === null) {
                res.status(404).json({error: "User has no accounts setup"});
                return;
            }
            const accounts = matrixUser.get("accounts");
            return Promise.all(Object.keys(accounts).map((slack_id) => {
                const account = accounts[slack_id];
                return main.getTeamFromStore(account.team_id).then(
                    (team) => ({team, slack_id})
                );
            }))
        }).then((results) => {
            const teams = results.map((res) => ({
                id: res.team.team_id,
                name: res.team.team_name,
                slack_id: res.slack_id,
            }));
            res.json({ teams });
        }).catch((err) => {
            res.status(500).json({error: err});
        })
    }
});

Provisioning.commands.getlink = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: function(main, req, res, matrix_room_id, user_id) {
        var room = main.getRoomByMatrixRoomId(matrix_room_id);
        if (!room) {
            res.status(404).json({error: "Link not found"});
            return;
        }

        log.info("Need to enquire if " + user_id + " is allowed to get links for " + matrix_room_id);

        return main.checkLinkPermission(matrix_room_id, user_id).then((allowed) => {
            if (!allowed) return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id
            });
        }).then(
            () => {
                // Convert the room 'status' into a scalar 'status'
                var status = room.getStatus();
                if (status.match(/^ready/)) {
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

                var auth_uri;
                var oauth2 = main.getOAuth2();
                if (oauth2 && !room.getAccessToken()) {
                    // We don't have an auth token but we do have the ability
                    // to ask for one
                    auth_uri = oauth2.makeAuthorizeURL({
                        room: room,
                        state: room.getInboundId(),
                    });
                }

                res.json({
                    status: status,
                    slack_channel_id: room.getSlackChannelId(),
                    slack_channel_name: room.getSlackChannelName(),
                    slack_webhook_uri: room.getSlackWebhookUri(),
                    team_id: room.getSlackTeamId(),
                    isWebhook: !room.getSlackBotId(),
                    // This is slightly a lie
                    matrix_room_id: matrix_room_id,
                    inbound_uri: main.getInboundUrlForRoom(room),
                    auth_uri: auth_uri,
                });
            }
        );
    }
});

Provisioning.commands.link = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: async function(main, req, res, matrix_room_id, user_id) {
        log.info("Need to enquire if " + user_id + " is allowed to link " + matrix_room_id);

        // Ensure we are in the room.
        await main._bridge.getIntent().join(matrix_room_id);

        const params = req.body;
        const opts = {
            matrix_room_id: matrix_room_id,
        };

        opts.slack_webhook_uri = params.slack_webhook_uri;
        opts.slack_channel_id = params.channel_id;
        opts.team_id = params.team_id;
        opts.user_id = user_id;

        // Check if the user is in the team.
        if (opts.team_id && !(await main.matrixUserInSlackTeam(opts.team_id, opts.user_id))) {
            return Promise.reject({
                code: 403,
                text: user_id + " is not in this team.",
            });
        }
        if (!(await main.checkLinkPermission(matrix_room_id, user_id))) {
            return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id,
            });
        }
        const room = await main.actionLink(opts);
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
        log.info(`Result of link for ${matrix_room_id} -> ${status} ${opts.slack_channel_id}`);
        res.json({
            status: status,
            slack_channel_name: room.getSlackChannelName(),
            slack_webhook_uri: room.getSlackWebhookUri(),
            matrix_room_id: matrix_room_id,
            inbound_uri: main.getInboundUrlForRoom(room),
        });
    }
});

Provisioning.commands.unlink = new Provisioning.Command({
    params: ["matrix_room_id", "user_id"],
    func: function(main, req, res, matrix_room_id, user_id) {
        log.info("Need to enquire if " + user_id + " is allowed to unlink " + matrix_room_id);

        return main.checkLinkPermission(matrix_room_id, user_id).then((allowed) => {
            if (!allowed) return Promise.reject({
                code: 403,
                text: user_id + " is not allowed to provision links in " + matrix_room_id,
            });

            return main.actionUnlink({matrix_room_id: matrix_room_id});
        }).then(
            ()    => { res.json({}); }
        );
    }
});

module.exports = Main;
