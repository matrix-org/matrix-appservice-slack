
import { Bridge, PrometheusMetrics, StateLookup,
    Logging, Intent, MatrixUser as BridgeMatrixUser,
    EventStore, RoomStore, UserStore, Request } from "matrix-appservice-bridge";
import * as Datastore from "nedb";
import * as path from "path";
import * as randomstring from "randomstring";
import * as rp from "request-promise-native";

import { IConfig } from "./IConfig";
import { OAuth2 } from "./OAuth2";
import { BridgedRoom } from "./BridgedRoom";
import { SlackGhost } from "./SlackGhost";
import { MatrixUser } from "./MatrixUser";
import { SlackHookHandler } from "./SlackHookHandler";
import { AdminCommands } from "./AdminCommands";
import * as Provisioning from "./Provisioning";
import { INTERNAL_ID_LEN } from "./BaseSlackHandler";
import { SlackRTMHandler } from "./SlackRTMHandler";

const log = Logging.get("Main");

const RECENT_EVENTID_SIZE = 20;

export interface ISlackTeam {
    id: string;
    domain: string;
    name: string;
}

export class Main {

    public get eventStore(): EventStore {
        return this.bridge.getEventStore();
    }

    public get roomStore(): RoomStore {
        return this.bridge.getRoomStore();
    }

    public get userStore(): UserStore {
        return this.bridge.getUserStore();
    }

    public get botIntent(): Intent {
        return this.bridge.getIntent();
    }

    public get userIdPrefix(): string {
        return this.config.username_prefix;
    }

    public get allRooms() {
        return Array.from(this.rooms);
    }

    public get botUserId(): string {
        return this.bridge.getBot().userId();
    }
    public readonly oauth2: OAuth2|null = null;

    private teams: Map<string, ISlackTeam> = new Map();

    private recentMatrixEventIds: string[] = new Array(RECENT_EVENTID_SIZE);
    private mostRecentEventIdIdx = 0;

    private rooms: BridgedRoom[] = [];
    private roomsBySlackChannelId: {[channelId: string]: BridgedRoom} = {};
    private roomsBySlackTeamId: {[teamId: string]: [BridgedRoom]} = {};
    private roomsByMatrixRoomId: {[roomId: string]: BridgedRoom} = {};
    private roomsByInboundId: {[inboundId: string]: BridgedRoom} = {};

    private ghostsByUserId: {[userId: string]: SlackGhost} = {};
    private matrixUsersById: {[userId: string]: MatrixUser} = {};

    private bridge: Bridge;

    // TODO(paul): ugh. this.getBotIntent() doesn't work before .run time
    // So we can't create the StateLookup instance yet
    private stateStorage: StateLookup|null = null;

    private teamDatastore: any|null = null;

    private slackHookHandler?: SlackHookHandler;
    private slackRtm?: SlackRTMHandler;

    private metrics: any;

    private adminCommands = new AdminCommands(this);

    constructor(public readonly config: IConfig) {
        if (config.oauth2) {
            this.oauth2 = new OAuth2({
                client_id: config.oauth2.client_id,
                client_secret: config.oauth2.client_secret,
                main: this,
                redirect_prefix: config.oauth2.redirect_prefix || config.inbound_uri_prefix,
            });
        }

        if (!config.enable_rtm || !config.slack_hook_port) {
            throw Error("Neither enable_rtm nor slack_hook_port is defined in the config." +
            "The bridge must define a listener in order to run");
        }

        const dbdir = config.dbdir || "";

        this.bridge = new Bridge({
            controller: {
                onEvent: (request: Request) => {
                    const ev = request.getData();
                    this.stateStorage.onEvent(ev);
                    this.onMatrixEvent(ev).then(() => {
                        log.info(`Handled ${ev.event_id} (${ev.room_id})`);
                    }).catch((ex) => {
                        log.error(`Failed to handle ${ev.event_id} (${ev.room_id})`, ex);
                    });
                },
                onUserQuery: () => ({}), // auto-provision users with no additional data
            },
            domain: config.homeserver.server_name,
            eventStore: path.join(dbdir, "event-store.db"),
            homeserverUrl: config.homeserver.url,
            registration: "slack-registration.yaml",
            roomStore: path.join(dbdir, "room-store.db"),
            userStore: path.join(dbdir, "user-store.db"),
        });

        if (config.enable_rtm) {
            this.slackRtm = new SlackRTMHandler(this);
        }

        if (config.slack_hook_port) {
            this.slackHookHandler = new SlackHookHandler(this);
        }

        if (config.enable_metrics) {
            this.initialiseMetrics();
        }
    }

    public getIntent(userId: string) {
        return this.bridge.getIntent(userId);
    }

    public initialiseMetrics() {
        this.metrics = this.bridge.getPrometheusMetrics();

        this.bridge.registerBridgeGauges(() => {
            const now = Date.now() / 1000;

            const remoteRoomsByAge = new PrometheusMetrics.AgeCounters();
            const matrixRoomsByAge = new PrometheusMetrics.AgeCounters();

            this.rooms.forEach((room) => {
                remoteRoomsByAge.bump(now - room.RemoteATime!);
                matrixRoomsByAge.bump(now - room.MatrixATime!);
            });

            const countAges = (users: {[key: string]: MatrixUser|SlackGhost}) => {
                const counts = new PrometheusMetrics.AgeCounters();

                Object.keys(users).forEach((id) => {
                    counts.bump(now - users[id].aTime!);
                });

                return counts;
            };

            return {
                matrixRoomConfigs:
                    Object.keys(this.roomsByMatrixRoomId).length,
                remoteRoomConfigs:
                    Object.keys(this.roomsByInboundId).length,

                // As a relaybot we don't create remote-side ghosts
                remoteGhosts: 0,

                matrixRoomsByAge,
                remoteRoomsByAge,

                matrixUsersByAge: countAges(this.matrixUsersById),
                remoteUsersByAge: countAges(this.ghostsByUserId),
            };
        });

        this.metrics.addCounter({
            help: "count of received messages",
            labels: ["side"],
            name: "received_messages",
        });
        this.metrics.addCounter({
            help: "count of sent messages",
            labels: ["side"],
            name: "sent_messages",
        });
        this.metrics.addCounter({
            help: "Count of the number of remote API calls made",
            labels: ["method"],
            name: "remote_api_calls",
        });
        this.metrics.addTimer({
            help: "Histogram of processing durations of received Matrix messages",
            labels: ["outcome"],
            name: "matrix_request_seconds",
        });
        this.metrics.addTimer({
            help: "Histogram of processing durations of received remote messages",
            labels: ["outcome"],
            name: "remote_request_seconds",
        });
    }

    public incCounter(name: string, labels: any = {}) {
        if (!this.metrics) { return; }
        this.metrics.incCounter(name, labels);
    }

    public incRemoteCallCounter(type: string) {
        if (!this.metrics) { return; }
        this.metrics.incCounter("remote_api_calls", {method: type});
    }

    public startTimer(name: string, labels: any = {}) {
        if (!this.metrics) { return () => {}; }
        return this.metrics.startTimer(name, labels);
    }

    public putRoomToStore(room: BridgedRoom) {
        const entry = room.toEntry();
        return this.roomStore.upsert({id: entry.id}, entry);
    }

    public putUserToStore(user: SlackGhost) {
        const entry = user.toEntry();
        return this.userStore.upsert({id: entry.id}, entry);
    }

    public getUrlForMxc(mxcUrl: string) {
        const hs = this.config.homeserver;
        return `${(hs.media_url || hs.url)}/_matrix/media/r0/download/${mxcUrl.substring("mxc://".length)}`;
    }

    public async getTeamDomainForMessage(message: any) {
        if (message.team_domain) {
            return message.team_domain;
        }

        if (!message.team_id) {
            throw new Error("Cannot determine team, no id given.");
        }

        if (this.teams.has(message.team_id)) {
            return this.teams.get(message.team_id)!.domain;
        }

        const room = this.getRoomBySlackChannelId(message.channel);

        if (!room) {
            log.error("Couldn't find channel in order to get team domain");
            return;
        }

        const channelsInfoApiParams = {
            json: true,
            qs: {
                token: room.AccessToken,
            },
            uri: "https://slack.com/api/team.info",
        };
        this.incRemoteCallCounter("team.info");
        const response = await rp(channelsInfoApiParams);
        if (!response.ok) {
            log.error(`Trying to fetch the ${message.team_id} team.`, response);
            return;
        }
        log.info("Got new team:", response);
        this.teams.set(message.team_id, response.team);
        return response.team.domain;
    }

    public getUserId(id: string, teamDomain: string) {
        const localpart = `${this.userIdPrefix}${teamDomain.toLowerCase()}_${id.toUpperCase()}`;
        return `@${localpart}:${this.config.homeserver.server_name}`;
    }

    public async getGhostForSlackMessage(message: any) {
        // Slack ghost IDs need to be constructed from user IDs, not usernames,
        // because users can change their names
        // TODO if the team_domain is changed, we will recreate all users.
        // TODO(paul): Steal MatrixIdTemplate from matrix-appservice-gitter

        // team_domain is gone, so we have to actually get the domain from a friendly object.
        const teamDomain = (await this.getTeamDomainForMessage(message)).toLowerCase();
        const userId = this.getUserId(
            message.user_id.toUpperCase(),
            teamDomain,
        );

        if (this.ghostsByUserId[userId]) {
            log.debug("Getting existing ghost from cache for", userId);
            return this.ghostsByUserId[userId];
        }

        const intent = this.bridge.getIntent(userId);
        const entries = await this.userStore.select({id: userId});

        let ghost;
        if (entries.length) {
            log.debug("Getting existing ghost for", userId);
            ghost = SlackGhost.fromEntry(this, entries[0], intent);
        } else {
            log.debug("Creating new ghost for", userId);
            ghost = new SlackGhost(
                this,
                userId,
                undefined,
                undefined,
                intent,
            );
            this.putUserToStore(ghost);
        }

        this.ghostsByUserId[userId] = ghost;
        return ghost;
    }

    public getOrCreateMatrixUser(id: string) {
        let u = this.matrixUsersById[id];
        if (u) {
            return u;
        }
        u = this.matrixUsersById[id] = new MatrixUser(this, {user_id: id});
        return u;
    }

    public genInboundId() {
        let attempts = 10;
        while (attempts > 0) {
            const id = randomstring.generate(INTERNAL_ID_LEN);
            if (!(id in this.roomsByInboundId)) { return id; }

            attempts--;
        }
        // Prevent tightlooping if randomness goes odd
        throw Error("Failed to generate a unique inbound ID after 10 attempts");
    }

    public async addBridgedRoom(room: BridgedRoom) {
        this.rooms.push(room);

        if (room.SlackChannelId) {
            this.roomsBySlackChannelId[room.SlackChannelId] = room;
        }

        if (room.InboundId) {
            this.roomsByInboundId[room.InboundId] = room;
        }

        if (room.SlackTeamId) {
            if (this.roomsBySlackTeamId[room.SlackTeamId]) {
                this.roomsBySlackTeamId[room.SlackTeamId].push(room);
            } else {
                this.roomsBySlackTeamId[room.SlackTeamId] = [ room ];
            }

            if (room.SlackBotToken && this.slackRtm) {
                // This will start a new RTM client for the team, if the team
                // doesn't currently have a client running.
                await this.slackRtm.startTeamClientIfNotStarted(room.SlackTeamId, room.SlackBotToken);
            }
        }

    }

    public removeBridgedRoom(room: BridgedRoom) {
        this.rooms = this.rooms.filter((r) => r !== room);

        if (room.SlackChannelId) {
            delete this.roomsBySlackChannelId[room.SlackChannelId];
        }

        if (room.InboundId) {
            delete this.roomsByInboundId[room.InboundId];
        }

        // XXX: We don't remove it from this.roomsBySlackTeamId?
    }

    public getRoomBySlackChannelId(channelId: string): BridgedRoom|undefined {
        return this.roomsBySlackChannelId[channelId];
    }

    public getRoomsBySlackTeamId(channelId: string) {
        return this.roomsBySlackTeamId[channelId] || [];
    }

    public getRoomBySlackChannelName(channelName: string) {
        for (const room of this.rooms) {
            if (room.SlackChannelName === channelName) {
                return room;
            }
        }

        return null;
    }

    public getRoomByMatrixRoomId(roomId: string): BridgedRoom|undefined {
        return this.roomsByMatrixRoomId[roomId];
    }

    public getRoomByInboundId(inboundId: string): BridgedRoom|undefined {
        return this.roomsByInboundId[inboundId];
    }

    public getInboundUrlForRoom(room) {
        return this.config.inbound_uri_prefix + room.getInboundId();
    }

    public getStoredEvent(roomId: string, eventType: string, stateKey?: string) {
        return this.stateStorage.getState(roomId, eventType, stateKey);
    }

    public async getState(roomId: string, eventType: string) {
        //   TODO: handle state_key. Has different return shape in the two cases
        const cachedEvent = this.getStoredEvent(roomId, eventType);
        if (cachedEvent && cachedEvent.length) {
            // StateLookup returns entire state events. client.getStateEvent returns
            //   *just the content*
            return cachedEvent[0].content;
        }

        return this.botIntent.client.getStateEvent(roomId, eventType);
    }

    public async listAllUsers(roomId: string) {
        const members: {[userId: string]: {
            displayname: string,
            avatar_url: string,
        }} = await this.bridge.getBot().getJoinedMembers(roomId);
        return Object.keys(members);
    }

    public async listGhostUsers(roomId: string) {
        const userIds = await this.listAllUsers(roomId);
        const regexp = new RegExp("^@" + this.config.username_prefix);
        return userIds.filter((i) => i.match(regexp));
    }

    public async drainAndLeaveMatrixRoom(roomId: string) {
        const userIds = await this.listGhostUsers(roomId);
        log.info(`Draining ${userIds.length} ghosts from ${roomId}`);
        await Promise.all(userIds.map((userId) =>
            this.getIntent(userId).leave(roomId),
        ));
        await this.botIntent.leave(roomId);
    }

    public async listRoomsFor(): Promise<string[]> {
        return this.bridge.getBot().getJoinedRooms();
    }

    public async onMatrixEvent(ev: {
        event_id: string,
        state_key: string,
        type: string,
        room_id: string,
        sender: string,
// tslint:disable-next-line: no-any
        content: any,
    }) {
        // simple de-dup
        const recents = this.recentMatrixEventIds;
        for (let i = 0; i < recents.length; i++) {
            if (recents[i] && recents[i] === ev.event_id) {
              // move the most recent ev to where we found a dup and add the
              // duplicate at the end (reasoning: we only want one of the
              // duplicated ev_id in the list, but we want it at the end)
              recents[i] = recents[this.mostRecentEventIdIdx];
              recents[this.mostRecentEventIdIdx] = ev.event_id;
              log.warn("Ignoring duplicate ev: " + ev.event_id);
              return;
            }
        }
        this.mostRecentEventIdIdx = (this.mostRecentEventIdIdx + 1) % RECENT_EVENTID_SIZE;
        recents[this.mostRecentEventIdIdx] = ev.event_id;

        this.incCounter("received_messages", {side: "matrix"});
        const endTimer = this.startTimer("matrix_request_seconds");

        const myUserId = this.bridge.getBot().getUserId();

        if (ev.type === "m.room.member" && ev.state_key === myUserId) {
            // A membership event about myself
            const membership = ev.content.membership;
            if (membership === "invite") {
                // Automatically accept all invitations
                // NOTE: This can race and fail if the invite goes down the AS stream
                // before the homeserver believes we can actually join the room.
                await this.botIntent.join(ev.room_id);
            }

            endTimer({outcome: "success"});
            return;
        }

        if (ev.type === "m.room.member"
            && this.bridge.getBot().isRemoteUser(ev.state_key)
            && ev.sender !== myUserId) {

            log.info(`${ev.state_key} got invite for ${ev.room_id} but we can't do DMs, warning room.`);
            const intent = this.getIntent(ev.state_key);
            try {
                await intent.join(ev.room_id);
                await intent.sendEvent(ev.room_id, "m.room.message", {
                    body: "The slack bridge doesn't support private messaging, or inviting to rooms.",
                    msgtype: "m.notice",
                });
            } catch (err) {
                log.error("Couldn't send warning to user(s) about not supporting PMs", err);
            }
            await intent.leave(ev.room_id);
            endTimer({outcome: "success"});
            return;
        }

        if (ev.sender === myUserId) {
            endTimer({outcome: "success"});
            return;
        }

        if (this.config.matrix_admin_room && ev.room_id === this.config.matrix_admin_room) {
            try {
                await this.onMatrixAdminMessage(ev);
            } catch (e) {
                log.error("Failed processing admin message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
            return;
        }

        const room = this.getRoomByMatrixRoomId(ev.room_id);
        if (!room) {
            log.warn(`Ignoring ev for matrix room with unknown slack channel: ${ev.room_id}`);
            endTimer({outcome: "dropped"});
            return;
        }

        // Handle a m.room.redaction event
        if (ev.type === "m.room.redaction") {
            try {
                await room.onMatrixRedaction(ev);
            } catch (e) {
                log.error("Failed procesing matrix message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
            return;
        }

        // Handle a m.room.message event
        if (ev.type === "m.room.message" || ev.content) {
            if (ev.content["m.relates_to"] !== undefined) {
                const relatesTo = ev.content["m.relates_to"];
                if (relatesTo.rel_type === "m.replace" && !relatesTo.event_id) {
                    // We have an edit.
                    try {
                        await room.onMatrixEdit(ev);
                    } catch (e) {
                        log.error("Failed processing matrix edit: ", e);
                        endTimer({outcome: "fail"});
                        return;
                    }
                    endTimer({outcome: "success"});
                    return;
                }
            }
            try {
                await room.onMatrixMessage(ev);
            } catch (e) {
                log.error("Failed processing matrix message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
            return;
        }
    }

    public async onMatrixAdminMessage(ev) {
        const cmd = ev.content.body;

        // Ignore "# comment" lines as chatter between humans sharing the console
        if (cmd.match(/^\s*#/))  {
            return;
        }

        log.info("Admin: " + cmd);

        const response: any[] = [];
        const respond = (responseMsg: string) => {
            if (!response) {
                log.info(`Command response too late: ${responseMsg}`);
                return;
            }
            response.push(responseMsg);
        };

        try {
            // This will return true or false if the command matched.
            const matched = await this.adminCommands.parse(cmd, respond);
            if (!matched) {
                log.debug("Unrecognised command: " + cmd);
                respond("Unrecognised command: " + cmd);
            } else if (response.length === 0) {
                respond("Done");
            }
        } catch (ex) {
            log.debug(`Command '${cmd}' failed to complete:`, ex);
            respond("Command failed: " + ex);
        }

        const message = response.join("\n");

        await this.botIntent.sendEvent(ev.room_id, "m.room.message", {
            body: message,
            format: "org.matrix.custom.html",
            formatted_body: `<pre>${message}</pre>`,
            msgtype: "m.notice",
        });
    }

    public async run(port: number) {
        log.info("Loading databases");
        await this.bridge.loadDatabases();
        log.info("Loading teams.db");
        this.teamDatastore = new Datastore({
            autoload: true,
            filename: path.join(this.config.dbdir || "", "teams.db"),
        });
        await new Promise((resolve, reject) => {
            this.teamDatastore.loadDatabase((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        }); });

        // Legacy-style BridgedRoom instances
        (await this.roomStore.select({
            matrix_id: {$exists: false},
        })).forEach((entry) => {
            log.error("Ignoring LEGACY room entry in room-store.db", entry);
        });

        //await this.slackHookHandler.startAndListen(this.config.slack_hook_port, this.config.tls);
        this.bridge.run(port, this.config);
        Provisioning.addAppServicePath(this.bridge, this);

        // TODO(paul): see above; we had to defer this until now
        this.stateStorage = new StateLookup({
            client: this.bridge.getIntent().client,
            eventTypes: ["m.room.member", "m.room.power_levels"],
        });

        const entries = await this.roomStore.select({
            matrix_id: {$exists: true},
        });

        await Promise.all(entries.map(async (entry) => {
            // These might be links for legacy-style BridgedRooms, or new-style
            // rooms
            // Only way to tell is via the form of the id
            const result = entry.id.match(/^INTEG-(.*)$/);
            if (result) {
                const room = BridgedRoom.fromEntry(this, entry);
                await this.addBridgedRoom(room);
                this.roomsByMatrixRoomId[entry.matrix_id] = room;
                this.stateStorage.trackRoom(entry.matrix_id);
            } else {
                log.error("Ignoring LEGACY room link entry", entry);
            }
        }));

        if (this.metrics) {
            this.metrics.addAppServicePath(this.bridge);
            // Send process stats again just to make the counters update sooner after
            // startup
            this.metrics.refresh();
        }
        log.info("Bridge initialised.");
    }

        // This so-called "link" action is really a multi-function generic provisioning
    // interface. It will
    //  * Create a BridgedRoom instance, linked to the given Matrix room ID
    //  * Associate a webhook_uri to an existing instance
    public async actionLink(opts: {
        matrix_room_id: string,
        slack_webhook_uri?: string,
        slack_channel_id?: string,
        slack_user_token?: string,
        slack_bot_token?: string,
        team_id?: string,
    }) {
        const matrixRoomId = opts.matrix_room_id;

        const existingRoom = this.getRoomByMatrixRoomId(matrixRoomId);
        let room: BridgedRoom;

        let isNew = false;
        if (!existingRoom) {
            try {
                await this.botIntent.join(matrixRoomId);
            } catch (ex) {
                log.error("Couldn't join room, not bridging");
                throw Error("Could not join room");
            }
            const inboundId = this.genInboundId();

            room = new BridgedRoom(this, {
                inbound_id: inboundId,
                matrix_room_id: matrixRoomId,
            });
            isNew = true;
            this.roomsByMatrixRoomId[matrixRoomId] = room;
            this.stateStorage.trackRoom(matrixRoomId);
        } else {
            room = existingRoom;
        }

        if (opts.slack_webhook_uri) {
            room.SlackWebhookUri = opts.slack_webhook_uri;
        }

        if (opts.slack_channel_id) {
            room.SlackChannelId = opts.slack_channel_id;
        }

        if (opts.slack_user_token) {
            room.SlackUserToken = opts.slack_user_token;
        }

        let teamToken = opts.slack_bot_token;

        if (opts.team_id) {
            teamToken = (await this.getTeamFromStore(opts.team_id)).bot_token;
        }

        if (teamToken) {
            room.SlackBotToken = teamToken;
            this.incRemoteCallCounter("channels.info");
            const response = await rp({
                json: true,
                qs: {
                    channel: opts.slack_channel_id,
                    token: teamToken,
                },
                url: "https://slack.com/api/channels.info",
            });

            if (!response.ok) {
                log.error(`channels.info for ${opts.slack_channel_id} errored:`, response);
                throw Error("Failed to get channel info");
            }

            room.SlackChannelName = response.channel.name;
            await Promise.all([
                room.refreshTeamInfo(),
                room.refreshUserInfo(),
                response,
            ]);
        }

        if (isNew) {
            await this.addBridgedRoom(room);
        }
        if (room.isDirty) {
            this.putRoomToStore(room);
        }

        return room;
    }

    public async actionUnlink(opts: {
        matrix_room_id: string,
    }) {
        const room = this.getRoomByMatrixRoomId(opts.matrix_room_id);
        if (!room) {
            throw new Error("Cannot unlink - unknown channel");
        }

        this.removeBridgedRoom(room);
        delete this.roomsByMatrixRoomId[opts.matrix_room_id];
        this.stateStorage.untrackRoom(opts.matrix_room_id);

        const id = room.toEntry().id;
        await this.drainAndLeaveMatrixRoom(opts.matrix_room_id);
        await this.roomStore.delete({id});
    }

    public async checkLinkPermission(matrixRoomId: string, userId: string) {
        const STATE_DEFAULT = 50;
        // We decide to allow a user to link or unlink, if they have a powerlevel
        //   sufficient to affect the 'm.room.power_levels' state; i.e. the
        //   "operator" heuristic.
        const powerLevels = await this.getState(matrixRoomId, "m.room.power_levels");
        const userLevel =
            (powerLevels.users && userId in powerLevels.users) ? powerLevels.users[userId] :
            powerLevels.users_default;

        const requiresLevel =
            (powerLevels.events && "m.room.power_levels" in powerLevels.events) ?
            powerLevels.events["m.room.power_levels"] :
            ("state_default" in powerLevels) ? powerLevels.powerLevels : STATE_DEFAULT;

        return userLevel >= requiresLevel;
    }

    public async setUserAccessToken(userId: string, teamId: string, slackId: string, accessToken: string) {
        const store = this.userStore;
        let matrixUser = await store.getMatrixUser(userId);
        matrixUser = matrixUser ? matrixUser : new BridgeMatrixUser(userId);
        const accounts = matrixUser.get("accounts") || {};
        accounts[slackId] = {
            access_token: accessToken,
            team_id: teamId,
        };
        matrixUser.set("accounts", accounts);
        await store.setMatrixUser(matrixUser);
        log.info(`Set new access token for ${userId} (team: ${teamId})`);
    }

    public updateTeamBotStore(teamId: string, teamName: string, userId: string, botToken: string) {
        this.teamDatastore.update({team_id: teamId}, {
            bot_token: botToken,
            team_id: teamId,
            team_name: teamName,
            user_id: userId,
        }, {upsert: true});
        log.info(`Setting details for team ${teamId} ${teamName}`);
    }

    public async getTeamFromStore(teamId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.teamDatastore.findOne({team_id: teamId}, (err, doc) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(doc);
            });
        });
    }

    public async matrixUserInSlackTeam(teamId: string, userId: string) {
        const matrixUser = await this.userStore.getMatrixUser(userId);
        if (matrixUser === null) {
            return false;
        }
        const accounts: {team_id: string}[] = Object.values(matrixUser.get("accounts"));
        return accounts.find((acct) => acct.team_id === teamId);
    }
// tslint:disable-next-line: max-file-line-count
}
