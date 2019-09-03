/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Bridge, PrometheusMetrics, StateLookup,
    Logging, Intent, MatrixUser as BridgeMatrixUser,
    Request } from "matrix-appservice-bridge";
import * as path from "path";
import * as randomstring from "randomstring";
import { WebClient } from "@slack/web-api";
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
import { TeamInfoResponse, ConversationsInfoResponse } from "./SlackResponses";

import { Datastore } from "./datastore/Models";
import { NedbDatastore } from "./datastore/NedbDatastore";
import { PgDatastore } from "./datastore/postgres/PgDatastore";

const log = Logging.get("Main");
const webLog = Logging.get(`slack-api`);

const RECENT_EVENTID_SIZE = 20;
export const METRIC_SENT_MESSAGES = "sent_messages";

export interface ISlackTeam {
    id: string;
    domain: string;
    name: string;
}

interface MetricsLabels { [labelName: string]: string; }

export class Main {

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

    public datastore!: Datastore;

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

    private slackHookHandler?: SlackHookHandler;
    private slackRtm?: SlackRTMHandler;

    // tslint:disable-next-line: no-any
    private metrics: PrometheusMetrics;

    private adminCommands = new AdminCommands(this);

    private teamClients: Map<string, WebClient> = new Map();

    // track which teams are using the rtm client.
    private rtmTeams: Set<string> = new Set();

    constructor(public readonly config: IConfig, registration: any) {
        if (config.oauth2) {
            if (!config.inbound_uri_prefix && !config.oauth2.redirect_prefix) {
                throw Error("Either inbound_uri_prefix or oauth2.redirect_prefix must be defined for oauth2 support");
            }
            const redirectPrefix = config.oauth2.redirect_prefix || config.inbound_uri_prefix;
            this.oauth2 = new OAuth2({
                client_id: config.oauth2.client_id,
                client_secret: config.oauth2.client_secret,
                main: this,
                redirect_prefix: redirectPrefix!,
            });
        }

        if ((!config.rtm || !config.rtm.enable) && (!config.slack_hook_port || !config.inbound_uri_prefix)) {
            throw Error("Neither rtm.enable nor slack_hook_port|inbound_uri_prefix is defined in the config." +
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
            registration,
            roomStore: path.join(dbdir, "room-store.db"),
            userStore: path.join(dbdir, "user-store.db"),
        });

        if (config.rtm && config.rtm.enable) {
            log.info("Enabled RTM");
            this.slackRtm = new SlackRTMHandler(this);
        }

        if (config.slack_hook_port) {
            this.slackHookHandler = new SlackHookHandler(this);
        }

        if (config.enable_metrics) {
            this.initialiseMetrics();
        }
    }

    public teamIsUsingRtm(teamId: string): boolean {
        return this.rtmTeams.has(teamId);
    }

    public getIntent(userId: string) {
        return this.bridge.getIntent(userId);
    }

    public async createOrGetTeamClient(teamId: string, token: string): Promise<WebClient> {
        if (this.teamClients.has(teamId)) {
            return this.teamClients.get(teamId)!;
        }
        return (await this.createTeamClient(token)).slackClient;
    }

    public async createTeamClient(token: string) {
        const opts = this.config.slack_client_opts;
        const slackClient = new WebClient(token, {
            ...opts,
            logger: {
                setLevel: () => {}, // We don't care about these.
                setName: () => {},
                debug: (msg: any[]) => {
                    // non-ideal way to detect calls to slack.
                    webLog.debug.bind(webLog);
                    const match = /apiCall\('([\w\.]+)'\) start/.exec(msg[0]);
                    if (match && match[1]) {
                        this.incRemoteCallCounter(match[1]);
                    }
                },
                warn: webLog.warn.bind(webLog),
                info: webLog.info.bind(webLog),
                error: webLog.error.bind(webLog),
            },
        });
        const teamInfo = (await slackClient.team.info()) as TeamInfoResponse;
        if (!teamInfo.ok) {
            throw Error("Could not create team client: " + teamInfo.error);
        }
        this.teamClients.set(teamInfo.team.id, slackClient);
        return { slackClient, team: teamInfo.team };
    }

    public getTeamClient(teamId: string): WebClient|undefined {
        return this.teamClients.get(teamId);
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
                matrixRoomConfigs: Object.keys(this.roomsByMatrixRoomId).length,
                remoteRoomConfigs: Object.keys(this.roomsByInboundId).length,
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
            name: METRIC_SENT_MESSAGES,
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

    public incCounter(name: string, labels: MetricsLabels = {}) {
        if (!this.metrics) { return; }
        this.metrics.incCounter(name, labels);
    }

    public incRemoteCallCounter(type: string) {
        if (!this.metrics) { return; }
        this.metrics.incCounter("remote_api_calls", {method: type});
    }

    public startTimer(name: string, labels: MetricsLabels = {}) {
        if (!this.metrics) { return () => {}; }
        return this.metrics.startTimer(name, labels);
    }

    public getUrlForMxc(mxcUrl: string) {
        const hs = this.config.homeserver;
        return `${(hs.media_url || hs.url)}/_matrix/media/r0/download/${mxcUrl.substring("mxc://".length)}`;
    }

    public async getTeamDomainForMessage(message: any, teamId?: string) {
        if (message.team_domain) {
            return message.team_domain;
        }

        if (!teamId) {
            if (message.team_id) {
                teamId = message.team_id;
            } else {
                throw new Error("Cannot determine team, no id given.");
            }
        }

        if (this.teams.has(teamId!)) {
            return this.teams.get(teamId!)!.domain;
        }

        const room = this.getRoomBySlackChannelId(message.channel || message.channel_id);

        if (!room) {
            log.error("Couldn't find channel in order to get team domain");
            return;
        }

        const cli = this.getTeamClient(message.team_id);
        if (!cli) {
            throw Error("No client for team");
        }
        const response = (await cli.team.info()) as TeamInfoResponse;
        if (!response.ok) {
            log.error(`Trying to fetch the ${teamId} team.`, response);
            return;
        }
        log.info("Got new team:", response);
        this.teams.set(teamId!, response.team);
        return response.team.domain;
    }

    public getUserId(id: string, teamDomain: string) {
        const localpart = `${this.userIdPrefix}${teamDomain.toLowerCase()}_${id.toUpperCase()}`;
        return `@${localpart}:${this.config.homeserver.server_name}`;
    }

    public async getGhostForSlackMessage(message: any, teamId: string): Promise<SlackGhost> {
        // Slack ghost IDs need to be constructed from user IDs, not usernames,
        // because users can change their names
        // TODO if the team_domain is changed, we will recreate all users.
        // TODO(paul): Steal MatrixIdTemplate from matrix-appservice-gitter

        // team_domain is gone, so we have to actually get the domain from a friendly object.
        const teamDomain = (await this.getTeamDomainForMessage(message, teamId)).toLowerCase();
        const userId = this.getUserId(
            message.user_id.toUpperCase(),
            teamDomain,
        );

        if (this.ghostsByUserId[userId]) {
            log.debug("Getting existing ghost from cache for", userId);
            return this.ghostsByUserId[userId];
        }

        const intent = this.bridge.getIntent(userId);
        const entry = await this.datastore.getUser(userId);

        let ghost: SlackGhost;
        if (entry) {
            log.debug("Getting existing ghost for", userId);
            ghost = SlackGhost.fromEntry(this, entry, intent);
        } else {
            log.debug("Creating new ghost for", userId);
            ghost = new SlackGhost(
                this,
                userId,
                undefined,
                undefined,
                intent,
            );
            await this.datastore.upsertUser(ghost);
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

        this.roomsByMatrixRoomId[room.MatrixRoomId] = room;

        if (room.SlackChannelId) {
            this.roomsBySlackChannelId[room.SlackChannelId] = room;
        }

        if (room.InboundId) {
            this.roomsByInboundId[room.InboundId] = room;
        }
        if (!room.SlackTeamId && room.SlackBotToken) {
            await room.refreshTeamInfo();
            await room.refreshUserInfo();
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
                this.rtmTeams.add(room.SlackTeamId);
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

    public getInboundUrlForRoom(room: BridgedRoom) {
        return this.config.inbound_uri_prefix + room.InboundId;
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

        if (this.config.matrix_admin_room && ev.room_id === this.config.matrix_admin_room &&
            ev.type === "m.room.message") {
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
                log.error("Failed procesing matrix redaction message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
            return;
        }

        // Handle a m.reaction event
        if (ev.type === "m.reaction") {
            try {
                await room.onMatrixReaction(ev);
            } catch (e) {
                log.error("Failed procesing reaction message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
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
        if (this.config.db) {
            if (this.config.db.engine.toLowerCase() !== "postgres") {
                throw Error("Unknown engine for database. Please use 'postgres'");
            }
            this.datastore = new PgDatastore(this.config.db.connectionString);
        } else {
            await this.bridge.loadDatabases();
            log.info("Loading teams.db");
            const NedbDs = require("nedb");
            const teamDatastore = new NedbDs({
                autoload: true,
                filename: path.join(this.config.dbdir || "", "teams.db"),
            });
            await new Promise((resolve, reject) => {
                teamDatastore.loadDatabase((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            }); });
            this.datastore = new NedbDatastore(
                this.bridge.getUserStore(),
                this.bridge.getRoomStore(),
                this.bridge.getEventStore(),
                teamDatastore,
            );
        }

        if (this.slackHookHandler) {
            await this.slackHookHandler.startAndListen(this.config.slack_hook_port!, this.config.tls);
        }

        this.bridge.run(port, this.config);
        Provisioning.addAppServicePath(this.bridge, this);

        // TODO(paul): see above; we had to defer this until now
        this.stateStorage = new StateLookup({
            client: this.bridge.getIntent().client,
            eventTypes: ["m.room.member", "m.room.power_levels"],
        });

        const entries = await this.datastore.getAllRooms();

        await Promise.all(entries.map(async (entry) => {
            const hasToken = entry.remote.slack_team_id && entry.remote.slack_bot_token;
            let cli: WebClient|undefined;
            try {
                if (hasToken) {
                    cli = await this.createOrGetTeamClient(entry.remote.slack_team_id!, entry.remote.slack_bot_token!);
                }
            } catch (ex) {
                log.error(`Failed to track room ${entry.matrix_id} ${entry.remote.name}:`, ex);
            }
            if (!cli && !entry.remote.webhook_uri) { // Do not warn if this is a webhook.
                log.warn(`${entry.remote.name} ${entry.remote.id} does not have a WebClient and will not be able to issue slack requests`);
            }
            const room = BridgedRoom.fromEntry(this, entry, cli);
            await this.addBridgedRoom(room);
            this.stateStorage.trackRoom(entry.matrix_id);
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

        if (!room.SlackChannelId && !room.SlackWebhookUri) {
            throw Error("Missing webhook_id OR channel_id");
        }

        let teamToken = opts.slack_bot_token;

        if (opts.team_id) {
            teamToken = (await this.datastore.getTeam(opts.team_id)).bot_token;
        }

        let cli: WebClient|undefined;

        if (opts.team_id || teamToken) {
            cli = await this.createOrGetTeamClient(opts.team_id!, teamToken!);
        }

        if (cli && opts.slack_channel_id) {
            // PSA: Bots cannot join channels, they have a limited set of APIs https://api.slack.com/methods/bots.info

            const infoRes = (await cli.conversations.info({ channel: opts.slack_channel_id})) as ConversationsInfoResponse;
            if (!infoRes.ok) {
                log.error(`conversations.info for ${opts.slack_channel_id} errored:`, infoRes);
                throw Error("Failed to get channel info");
            }
            room.setBotClient(cli);
            room.SlackBotToken = teamToken;
            room.SlackChannelName = infoRes.channel.name;
            await Promise.all([
                room.refreshTeamInfo(),
                room.refreshUserInfo(),
            ]);
        } else if (teamToken) {
            // No channel id given, but we have a token so store it.
            room.SlackBotToken = teamToken;
        }

        if (isNew) {
            await this.addBridgedRoom(room);
        }
        if (room.isDirty) {
            await this.datastore.upsertRoom(room);
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
        await this.datastore.deleteRoom(id);
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
        let matrixUser = await this.datastore.getMatrixUser(userId);
        matrixUser = matrixUser ? matrixUser : new BridgeMatrixUser(userId);
        const accounts = matrixUser.get("accounts") || {};
        accounts[slackId] = {
            access_token: accessToken,
            team_id: teamId,
        };
        matrixUser.set("accounts", accounts);
        await this.datastore.storeMatrixUser(matrixUser);
        log.info(`Set new access token for ${userId} (team: ${teamId})`);
    }

    public async matrixUserInSlackTeam(teamId: string, userId: string) {
        const matrixUser = await this.datastore.getMatrixUser(userId);
        if (matrixUser === null) {
            return false;
        }
        const accounts: {team_id: string}[] = Object.values(matrixUser.get("accounts"));
        return accounts.find((acct) => acct.team_id === teamId);
    }

    public async getNullGhostDisplayName(channel: string, userId: string): Promise<string> {
        const nullGhost = new SlackGhost(this);
        const room = this.getRoomBySlackChannelId(channel);
        if (!room || !room.SlackClient) {
            return userId;
        }
        return (await nullGhost.getDisplayname(userId, room!.SlackClient!)) || userId;
    }
}
