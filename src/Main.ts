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

import { Bridge, PrometheusMetrics, Gauge, StateLookup,
    Logging, Intent, Request } from "matrix-appservice-bridge";
import * as path from "path";
import * as randomstring from "randomstring";
import { WebClient } from "@slack/web-api";
import { IConfig, CACHING_DEFAULTS } from "./IConfig";
import { OAuth2 } from "./OAuth2";
import { BridgedRoom } from "./BridgedRoom";
import { SlackGhost } from "./SlackGhost";
import { MatrixUser } from "./MatrixUser";
import { SlackHookHandler } from "./SlackHookHandler";
import { AdminCommands } from "./AdminCommands";
import { Provisioner } from "./Provisioning";
import { INTERNAL_ID_LEN } from "./BaseSlackHandler";
import { SlackRTMHandler } from "./SlackRTMHandler";
import { ConversationsInfoResponse, ConversationsOpenResponse, AuthTestResponse, UsersInfoResponse } from "./SlackResponses";
import { Datastore, TeamEntry, RoomEntry } from "./datastore/Models";
import { NedbDatastore } from "./datastore/NedbDatastore";
import { PgDatastore } from "./datastore/postgres/PgDatastore";
import { SlackClientFactory } from "./SlackClientFactory";
import { Response } from "express";
import { SlackRoomStore } from "./SlackRoomStore";
import * as QuickLRU from "quick-lru";
import PQueue from "p-queue";
import { UserAdminRoom } from "./rooms/UserAdminRoom";
import { TeamSyncer } from "./TeamSyncer";
import { AppService, AppServiceRegistration } from "matrix-appservice";
import { SlackGhostStore } from "./SlackGhostStore";
import { AllowDenyList } from "./AllowDenyList";

const log = Logging.get("Main");

const RECENT_EVENTID_SIZE = 20;
const STARTUP_TEAM_INIT_CONCURRENCY = 10;
const STARTUP_RETRY_TIME_MS = 5000;
export const METRIC_ACTIVE_USERS = "active_users";
export const METRIC_ACTIVE_ROOMS = "active_rooms";
export const METRIC_PUPPETS = "remote_puppets";
export const METRIC_RECEIVED_MESSAGE = "received_messages";
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

    public get botUserId(): string {
        return this.bridge.getBot().getUserId();
    }

    public get clientFactory(): SlackClientFactory {
        return this.clientfactory;
    }

    public get ghostStore(): SlackGhostStore {
        return this.ghosts;
    }

    public readonly oauth2: OAuth2|null = null;

    public datastore!: Datastore;

    private recentMatrixEventIds: string[] = new Array(RECENT_EVENTID_SIZE);
    private mostRecentEventIdIdx = 0;

    public readonly rooms: SlackRoomStore = new SlackRoomStore();
    private ghosts!: SlackGhostStore; // Defined in .run

    private matrixUsersById: QuickLRU<string, MatrixUser>;

    private bridge: Bridge;
    private appservice: AppService;
    private ready: boolean = false;

    // TODO(paul): ugh. this.getBotIntent() doesn't work before .run time
    // So we can't create the StateLookup instance yet
    private stateStorage: StateLookup|null = null;

    private slackHookHandler?: SlackHookHandler;
    private slackRtm?: SlackRTMHandler;

    private metrics: PrometheusMetrics;
    private metricsCollectorInterval?: NodeJS.Timeout;
    private metricActiveRooms: Gauge;
    private metricActiveUsers: Gauge;
    private metricPuppets: Gauge;

    private adminCommands = new AdminCommands(this);
    private clientfactory!: SlackClientFactory;
    public readonly teamSyncer?: TeamSyncer;
    public readonly adl: AllowDenyList;

    private provisioner: Provisioner;

    constructor(public readonly config: IConfig, registration: AppServiceRegistration) {
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
                template_file: config.oauth2.html_template || path.join(__dirname, ".." , "templates/oauth_result.html.njk") ,
            });
        }

        config.caching = { ...CACHING_DEFAULTS, ...config.caching };

        this.matrixUsersById = new QuickLRU({ maxSize: config.caching.matrixUserCache });

        if ((!config.rtm || !config.rtm.enable) && (!config.slack_hook_port || !config.inbound_uri_prefix)) {
            throw Error("Neither rtm.enable nor slack_hook_port|inbound_uri_prefix is defined in the config." +
            "The bridge must define a listener in order to run");
        }

        if ((!config.rtm?.enable || !config.oauth2) && config.puppeting?.enabled) {
            throw Error("Either rtm and/or oaurh2 is not enabled, but puppeting is enabled. Both need to be enabled for puppeting to work");
        }

        let bridgeStores = {};
        const usingNeDB = config.db === undefined;
        if (usingNeDB) {
            const dbdir = config.dbdir || "";
            const URL = "https://github.com/matrix-org/matrix-appservice-slack/blob/master/docs/datastores.md";
            log.warn("** NEDB IS END-OF-LIFE **");
            log.warn("Starting with version 1.0, the nedb datastore is being discontinued in favour of " +
                     `postgresql. Please see ${URL} for more informmation.`);
            bridgeStores = {
                eventStore: path.join(dbdir, "event-store.db"),
                roomStore: path.join(dbdir, "room-store.db"),
                userStore: path.join(dbdir, "user-store.db"),
            };
        }

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
            roomUpgradeOpts: {
                consumeEvent: true,
                migrateGhosts: true,
                onRoomMigrated: this.onRoomUpgrade.bind(this),
                migrateStoreEntries: false,
            },
            domain: config.homeserver.server_name,
            homeserverUrl: config.homeserver.url,
            registration,
            ...bridgeStores,
            disableContext: true,
        });

        this.provisioner = new Provisioner(this, this.bridge);

        if (!usingNeDB) {
            // If these are undefined in the constructor, default names
            // are used. We want to override those names so these stores
            // will never be created.
            this.bridge.opts.userStore = undefined;
            this.bridge.opts.roomStore = undefined;
            this.bridge.opts.eventStore = undefined;
        }

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

        if (config.team_sync) {
            this.teamSyncer = new TeamSyncer(this);
        }

        this.adl = new AllowDenyList(config.puppeting?.direct_messages);

        const homeserverToken = registration.getHomeserverToken();
        if (homeserverToken === null) {
            throw Error("Homeserver token is null");
        }

        this.appservice = new AppService({
            homeserverToken,
            httpMaxSizeBytes: 0, // This field is optional.
        });
    }

    public teamIsUsingRtm(teamId: string): boolean {
        return (this.slackRtm !== undefined) && this.slackRtm.teamIsUsingRtm(teamId);
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

            this.rooms.all.forEach((room) => {
                remoteRoomsByAge.bump(now - room.RemoteATime!);
                matrixRoomsByAge.bump(now - room.MatrixATime!);
            });

            const countAges = (users: QuickLRU<string, MatrixUser|SlackGhost>) => {
                const counts = new PrometheusMetrics.AgeCounters();
                const snapshot = [...users.values()].filter((u) => u !== undefined && u.aTime! > 0);
                for (const user of snapshot) {
                    counts.bump(now - user.aTime!);
                }
                return counts;
            };

            return {
                matrixRoomConfigs: this.rooms.matrixRoomCount,
                remoteRoomConfigs: this.rooms.remoteRoomCount,
                // As a relaybot we don't create remote-side ghosts
                remoteGhosts: 0,

                matrixRoomsByAge,
                remoteRoomsByAge,

                matrixUsersByAge: countAges(this.matrixUsersById),
                remoteUsersByAge: countAges(this.ghosts.cached),
            };
        });

        this.metrics.addCounter({
            help: "count of received messages",
            labels: ["side"],
            name: METRIC_RECEIVED_MESSAGE,
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
        this.metricActiveUsers = this.metrics.addGauge({
            help: "Count of active users",
            labels: ["remote", "team_id"],
            name: METRIC_ACTIVE_USERS,
        });
        this.metricActiveRooms = this.metrics.addGauge({
            help: "Count of active bridged rooms (types are 'channel' and 'user')",
            labels: ["team_id", "type"],
            name: METRIC_ACTIVE_ROOMS,
        });
        this.metricPuppets = this.metrics.addGauge({
            help: "Amount of puppeted users on the remote side of the bridge",
            labels: ["team_id"],
            name: METRIC_PUPPETS,
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

    /**
     * Gathers the active rooms and users from the database and updates the metrics.
     * This function should be called on a regular interval or after an important
     * change to the metrics has happened.
     */
    public async updateActivityMetrics() {
        const roomsByTeamAndType = await this.datastore.getActiveRoomsPerTeam();
        const usersByTeamAndRemote = await this.datastore.getActiveUsersPerTeam();

        this.metricActiveRooms.reset();
        for (const [teamId, teamData] of roomsByTeamAndType.entries()) {
            for (const [roomType, numberOfActiveRooms] of teamData.entries()) {
                this.metricActiveRooms.set({ team_id: teamId, type: roomType }, numberOfActiveRooms);
            }
        }

        this.metricActiveUsers.reset();
        for (const [teamId, teamData] of usersByTeamAndRemote.entries()) {
            this.metricActiveUsers.set({ team_id: teamId, remote: true }, teamData.get(true) || 0);
            this.metricActiveUsers.set({ team_id: teamId, remote: false }, teamData.get(false) || 0);
        }
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
                throw Error("Cannot determine team, no id given.");
            }
        }

        const team = await this.datastore.getTeam(teamId!);
        if (team) {
            return team.domain;
        }
    }

    public getOrCreateMatrixUser(id: string) {
        let u = this.matrixUsersById.get(id);
        if (u) {
            return u;
        }
        u = new MatrixUser(this, {user_id: id});
        this.matrixUsersById.set(id, u);
        return u;
    }

    public genInboundId() {
        let attempts = 10;
        while (attempts > 0) {
            const id = randomstring.generate(INTERNAL_ID_LEN);
            if (this.rooms.getByInboundId(id) === undefined) {
                return id;
            }
            attempts--;
        }
        // Prevent tightlooping if randomness goes odd
        throw Error("Failed to generate a unique inbound ID after 10 attempts");
    }

    public async addBridgedRoom(room: BridgedRoom) {
        this.rooms.upsertRoom(room);
        if (this.slackRtm && room.SlackTeamId) {
            // This will start a new RTM client for the team, if the team
            // doesn't currently have a client running.
            await this.slackRtm.startTeamClientIfNotStarted(room.SlackTeamId);
        }
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
        state_key?: string,
        type: string,
        room_id: string,
        sender: string,
        // tslint:disable-next-line: no-any
        content: any,
    }) {
        if (ev.sender === this.botUserId) {
            // We don't want to handle echo.
            return;
        }
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

        this.incCounter(METRIC_RECEIVED_MESSAGE, {side: "matrix"});
        const endTimer = this.startTimer("matrix_request_seconds");

        if (UserAdminRoom.IsAdminRoomInvite(ev, this.botUserId)) {
            await this.datastore.setUserAdminRoom(ev.sender, ev.room_id);
            await this.botIntent.join(ev.room_id);
            await this.botIntent.sendMessage(ev.room_id, {
                msgtype: "m.notice",
                body: "Welcome to your Slack bridge admin room. Please say `help` for commands.",
                formatted_body: "Welcome to your Slack bridge admin room. Please say <code>help</code> for commands.",
                format: "org.matrix.custom.html",
            });
            endTimer({outcome: "success"});
            return;
        }

        if (ev.type === "m.room.member" && ev.state_key === this.botUserId) {
            // A membership event about myself
            const membership = ev.content.membership;
            const forRoom = this.rooms.getByMatrixRoomId(ev.room_id);
            if (membership === "invite") {
                // Automatically accept all invitations
                // NOTE: This can race and fail if the invite goes down the AS stream
                // before the homeserver believes we can actually join the room.
                await this.botIntent.join(ev.room_id);
                // Mark the room as active if we managed to join.
                if (forRoom) {
                    forRoom.MatrixRoomActive = true;
                    this.stateStorage.trackRoom(ev.room_id);
                }
            } else if (membership === "leave" || membership === "ban") {
                // We've been kicked out :(
                if (forRoom) {
                    forRoom.MatrixRoomActive = false;
                    this.stateStorage.untrackRoom(ev.room_id);
                }
            }
            endTimer({outcome: "success"});
            return;
        }

        if (ev.type === "m.room.member"
            && ev.state_key
            && this.bridge.getBot().isRemoteUser(ev.state_key)
            && ev.content.is_direct) {

            try {
                await this.handleDmInvite(ev.state_key, ev.sender, ev.room_id);
                endTimer({outcome: "success"});
            } catch (e) {
                log.error("Failed to handle DM invite: ", e);
                endTimer({outcome: "fail"});
            }
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

        const room = this.rooms.getByMatrixRoomId(ev.room_id);
        if (!room) {
            const adminRoomUser = await this.datastore.getUserForAdminRoom(ev.room_id);
            if (adminRoomUser) {
                if (adminRoomUser !== ev.sender) {
                    // Not the correct user, ignore.
                    endTimer({outcome: "dropped"});
                    return;
                }
                try {
                    const adminRoom = this.rooms.getOrCreateAdminRoom(ev.room_id, adminRoomUser, this);
                    await adminRoom.handleEvent(ev);
                    endTimer({outcome: "success"});
                } catch (ex) {
                    log.error("Failed to handle admin mesage:", ex);
                    endTimer({outcome: "dropped"});
                }
                return;
            }
            log.warn(`Ignoring ev for matrix room with unknown slack channel: ${ev.room_id}`);
            endTimer({outcome: "dropped"});
            return;
        }

        if (ev.type === "m.room.member" && ev.state_key) {
            if (this.bridge.getBot().isRemoteUser(ev.state_key)
                && !this.bridge.getBot().isRemoteUser(ev.sender)
                && ev.state_key !== this.botUserId) {
                await room.onMatrixInvite(ev.sender, ev.state_key);
                endTimer({ outcome: "success" });
                return;
            }

            if (!this.bridge.getBot().isRemoteUser(ev.state_key)) {
                const membership = ev.content.membership;
                if (membership === "join") {
                    await room.onMatrixJoin(ev.state_key);
                } else if (membership === "leave" || membership === "ban") {
                    await room.onMatrixLeave(ev.state_key);
                }
                return;
            }
        }

        // Handle a m.room.redaction event
        if (ev.type === "m.room.redaction") {
            try {
                await room.onMatrixRedaction(ev);
            } catch (e) {
                log.error("Failed processing matrix redaction message: ", e);
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
                log.error("Failed processing reaction message: ", e);
                endTimer({outcome: "fail"});
                return;
            }
            endTimer({outcome: "success"});
        }

        let success = false;

        // Handle a m.room.message event
        if (ev.type !== "m.room.message" || !ev.content) {
            log.debug(`${ev.event_id} ${ev.room_id} cannot be handled`);
            return;
        }

        if (ev.content["m.relates_to"] !== undefined) {
            const relatesTo = ev.content["m.relates_to"];
            if (relatesTo.rel_type === "m.replace" && relatesTo.event_id) {
                // We have an edit.
                try {
                    success = await room.onMatrixEdit(ev);
                } catch (e) {
                    log.error("Failed processing matrix edit: ", e);
                    endTimer({outcome: "fail"});
                }
                return;
            }
        } // Allow this to fall through, so we can handle replies.

        try {
            log.info(`Handling matrix room message ${ev.event_id} ${ev.room_id}`);
            success = await room.onMatrixMessage(ev);
        } catch (e) {
            log.error("Failed processing matrix message: ", e);
            endTimer({outcome: "fail"});
            return;
        }

        endTimer({outcome: success ? "success" : "dropped"});
    }

    public async handleDmInvite(recipient: string, sender: string, roomId: string) {
        const intent = this.getIntent(recipient);
        await intent.join(roomId);
        if (!this.slackRtm) {
            await intent.sendEvent(roomId, "m.room.message", {
                body: "This slack bridge instance doesn't support private messaging.",
                msgtype: "m.notice",
            });
            await intent.leave();
            return;
        }


        const slackGhost = await this.ghosts.getExisting(recipient);
        if (!slackGhost || !slackGhost.teamId) {
            // TODO: Create users dynamically who have never spoken.
            // https://github.com/matrix-org/matrix-appservice-slack/issues/211
            await intent.sendEvent(roomId, "m.room.message", {
                body: "The user does not exist or has not used the bridge yet.",
                msgtype: "m.notice",
            });
            await intent.leave(roomId);
            return;
        }

        const teamId = slackGhost.teamId;
        const rtmClient = this.slackRtm!.getUserClient(teamId, sender);
        const slackClient = await this.clientFactory.getClientForUser(teamId, sender);
        if (!rtmClient || !slackClient) {
            await intent.sendEvent(roomId, "m.room.message", {
                body: "You have not enabled puppeting for this Slack workspace. You must do that to speak to members.",
                msgtype: "m.notice",
            });
            await intent.leave(roomId);
            return;
        }

        const userData = (await slackClient.users.info({
            user: slackGhost.slackId,
        })) as UsersInfoResponse;

        // Check if the user is denied Slack Direct Messages (DMs)
        if (!this.adl.allowDM(sender, slackGhost.slackId, userData.user?.name)) {
            await intent.sendEvent(roomId, "m.room.message", {
                body: "The admin of this Slack bridge has denied you to directly message Slack users.",
                msgtype: "m.notice",
            });
            await intent.leave();
            return;
        }
        
        const openResponse = (await slackClient.conversations.open({users: slackGhost.slackId, return_im: true})) as ConversationsOpenResponse;
        if (openResponse.already_open) {
            // Check to see if we have a room for this channel already.
            const existing = this.rooms.getBySlackChannelId(openResponse.channel.id);
            if (existing) {
                await this.datastore.deleteRoom(existing.InboundId);
                await intent.sendEvent(roomId, "m.room.message", {
                    body: "You already have a conversation open with this person, leaving that room and reattaching here.",
                    msgtype: "m.notice",
                });
                await intent.leave(existing.MatrixRoomId);
            }
        }
        const puppetIdent = (await slackClient.auth.test()) as AuthTestResponse;
        const team = await this.datastore.getTeam(teamId);
        // The convo may be open, but we do not have a channel for it. Create the channel.
        const room = new BridgedRoom(this, {
            inbound_id: openResponse.channel.id,
            matrix_room_id: roomId,
            slack_team_id: puppetIdent.team_id,
            slack_channel_id: openResponse.channel.id,
            slack_channel_name: undefined,
            puppet_owner: sender,
            is_private: true,
            slack_type: "im",
        }, team! , slackClient);
        room.updateUsingChannelInfo(openResponse);
        await this.addBridgedRoom(room);
        await this.datastore.upsertRoom(room);
        await slackGhost.intent.join(roomId);
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
                log.debug("Unrecognised command");
                respond("Unrecognised command");
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

    /**
     * Ensures the bridge bot is registered and updates its profile info.
     */
    private async applyBotProfile() {
        log.info("Ensuring the bridge bot is registered");
        const intent = this.botIntent;
        // The bot believes itself to always be registered, even when it isn't.
        intent.opts.registered = false;
        await intent._ensureRegistered();
        const profile = await intent.getProfileInfo(this.botUserId);
        if (this.config.bot_profile?.displayname && profile.displayname !== this.config.bot_profile?.displayname) {
            await intent.setDisplayName(this.config.bot_profile?.displayname);
        }
        if (this.config.bot_profile?.avatar_url && profile.avatar_url !== this.config.bot_profile?.avatar_url) {
            await intent.setAvatarUrl(this.config.bot_profile?.avatar_url);
        }
    }

    /**
     * Starts the bridge.
     * @param cliPort A port to listen to provided by the user via a CLI option.
     * @returns The port the appservice listens to.
     */
    public async run(cliPort: number): Promise<number> {
        log.info("Loading databases");
        if (this.oauth2) {
            await this.oauth2.compileTemplates();
        }

        const dbEngine = this.config.db ? this.config.db.engine.toLowerCase() : "nedb";
        if (dbEngine === "postgres") {
            const postgresDb = new PgDatastore(this.config.db!.connectionString);
            await postgresDb.ensureSchema();
            this.datastore = postgresDb;
        } else if (dbEngine === "nedb") {
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
        } else {
            throw Error("Unknown engine for database. Please use 'postgres' or 'nedb");
        }

        this.ghosts = new SlackGhostStore(this.rooms, this.datastore, this.config, this.bridge);

        this.clientfactory = new SlackClientFactory(this.datastore, this.config, (method: string) => {
            this.incRemoteCallCounter(method);
        }, (teamId: string, delta: number) => {
            if (this.metricPuppets) {
                this.metricPuppets.inc({ team_id: teamId }, delta);
            }
        });
        let puppetsWaiting: Promise<unknown> = Promise.resolve();
        if (this.slackRtm) {
            const puppetEntries = await this.datastore.getPuppetedUsers();
            puppetsWaiting = Promise.all(puppetEntries.map(async (entry) => {
                try {
                    return this.slackRtm!.startUserClient(entry);
                } catch (ex) {
                    log.warn(`Failed to start puppet client for ${entry.matrixId}:`, ex);
                }
            }));
        }

        if (this.slackHookHandler) {
            await this.slackHookHandler.startAndListen(this.config.slack_hook_port!, this.config.tls);
        }
        const port = this.config.homeserver.appservice_port || cliPort;
        this.bridge.run(port, this.config, this.appservice);

        this.bridge.addAppServicePath({
            handler: this.onHealthProbe.bind(this.bridge),
            method: "GET",
            path: "/health",
            checkToken: false,
        });

        this.bridge.addAppServicePath({
            handler: this.onReadyProbe.bind(this.bridge),
            method: "GET",
            path: "/ready",
            checkToken: false,
        });

        this.stateStorage = new StateLookup({
            client: this.bridge.getIntent().client,
            eventTypes: ["m.room.member", "m.room.power_levels"],
        });


        let joinedRooms: string[]|null = null;
        while(joinedRooms === null) {
            try {
                joinedRooms = await this.bridge.getBot().getJoinedRooms() as string[];
            } catch (ex) {
                if (ex.errcode === 'M_UNKNOWN_TOKEN') {
                    log.error("The homeserver doesn't recognise this bridge, have you configured the homeserver with the appservice registration file?");
                } else {
                    log.error("Failed to fetch room list:", ex);
                }
                log.error(`Waiting ${STARTUP_RETRY_TIME_MS}ms before retrying`);
                await new Promise(((resolve) => setTimeout(resolve, STARTUP_RETRY_TIME_MS)));
            }
        }

        try {
            await this.applyBotProfile();
        } catch (ex) {
            log.warn(`Failed to set bot profile on startup: ${ex}`);
        }

        if (this.config.matrix_admin_room && !joinedRooms.includes(this.config.matrix_admin_room)) {
            log.warn("The bot is not in the admin room. You should invite the bot in order to control the bridge.");
        }

        const provisioningEnabled = this.config.provisioning?.enabled;

        // Previously, this was always true.
        if (provisioningEnabled === undefined ? true : provisioningEnabled) {
            this.provisioner.addAppServicePath();
        }

        log.info("Fetching teams");
        const teams = await this.datastore.getAllTeams();
        log.info(`Loaded ${teams.length} teams`);
        const teamClients: { [id: string]: WebClient } = {};
        const teamPromiseFunctions = teams.map((team, i) => (
            async() => {
                log.info(`[${i}/${teams.length}] Getting team client for ${team.name || team.id}`);
                // This will create team clients before we use them for any rooms,
                // as a pre-optimisation.
                try {
                    teamClients[team.id] = await this.clientFactory.getTeamClient(team.id);
                } catch (ex) {
                    log.error(`Failed to create client for ${team.id}, some rooms may be unbridgable`);
                    log.error(ex);
                }
                // Also start RTM clients for teams.
                // Ensure the token is a bot token so that we can actually enable RTM for these teams.
                if (this.slackRtm && team.bot_token.startsWith("xoxb")) {
                    log.info(`Starting RTM for ${team.id}`);
                    try {
                        await this.slackRtm!.startTeamClientIfNotStarted(team.id);
                    } catch (ex) {
                        log.warn(`Failed to start RTM for ${team.id}, rooms may be missing slack messages: ${ex}`);
                    }
                    log.info(`Started RTM for ${team.id}`);
                }
            }
        ));
        const teamPromises = new PQueue({ concurrency: STARTUP_TEAM_INIT_CONCURRENCY });
        // .addAll waits for all promises to resolve.
        await teamPromises.addAll(teamPromiseFunctions);
        log.info("Finished loading all team clients");

        const entries = await this.datastore.getAllRooms();
        log.info(`Found ${entries.length} room entries in store`);
        await Promise.all(entries.map(async (entry, i) => {
            log.info(`[${i}/${entries.length}] Loading room entry ${entry.matrix_id}`);
            try {
                await this.startupLoadRoomEntry(entry, joinedRooms as string[], teamClients);
            } catch (ex) {
                log.error(`Failed to load entry ${entry.matrix_id}, exception thrown`, ex);
            }
        }));

        const teamSyncPromise = this.teamSyncer ? this.teamSyncer.syncAllTeams(teamClients) : null;

        if (this.metrics) {
            this.metrics.addAppServicePath(this.bridge);

            // Regularly update the metrics for active rooms and users
            const ONE_HOUR = 60 * 60 * 1000;
            this.metricsCollectorInterval = setInterval(() => {
                log.info("Recalculating activity metrics...");
                this.updateActivityMetrics().catch((err) => {
                    log.error(`Error updating activity metrics`, err);
                });
            }, ONE_HOUR);
            await this.updateActivityMetrics();

            // Send process stats again just to make the counters update sooner after
            // startup
            this.metrics.refresh();
        }
        await puppetsWaiting;
        await teamSyncPromise;
        log.info("Bridge initialised");
        this.ready = true;
        return port;
    }

    private async startupLoadRoomEntry(entry: RoomEntry, joinedRooms: string[], teamClients: {[teamId: string]: WebClient}) {
        // If we aren't in the room, mark as inactive until we get re-invited.
        const activeRoom = entry.remote.puppet_owner !== undefined || joinedRooms.includes(entry.matrix_id);
        if (!activeRoom) {
            log.warn(`${entry.matrix_id} marked as inactive, bot is not joined to room`);
        }
        const teamId = entry.remote.slack_team_id;
        const teamEntry = teamId ? await this.datastore.getTeam(teamId) || undefined : undefined;
        let slackClient: WebClient|null = null;
        try {
            if (entry.remote.puppet_owner) {
                // Puppeted room (like a DM)
                slackClient = await this.clientFactory.getClientForUser(entry.remote.slack_team_id!, entry.remote.puppet_owner);
            } else if (teamId && teamClients[teamId]) {
                slackClient = teamClients[teamId];
            }
        } catch (ex) {
            log.error(`Failed to track room ${entry.matrix_id} ${entry.remote.name}:`, ex);
        }
        if (!slackClient && !entry.remote.webhook_uri) { // Do not warn if this is a webhook.
            log.warn(`${entry.remote.name} ${entry.remote.id} does not have a WebClient and will not be able to issue slack requests`);
        }
        const room = BridgedRoom.fromEntry(this, entry, teamEntry, slackClient || undefined);
        await this.addBridgedRoom(room);
        room.MatrixRoomActive = activeRoom;
        if (!room.IsPrivate && activeRoom) {
            // Only public rooms can be tracked.
            try {
                await this.stateStorage.trackRoom(entry.matrix_id);
            } catch (ex) {
                this.stateStorage.untrackRoom(entry.matrix_id);
                room.MatrixRoomActive = false;
            }
        }
    }

    // This so-called "link" action is really a multi-function generic provisioning
    // interface. It will
    //  * Create a BridgedRoom instance, linked to the given Matrix room ID
    //  * Associate a webhook_uri to an existing instance
    public async actionLink(opts: {
        matrix_room_id: string,
        slack_webhook_uri?: string,
        slack_channel_id?: string,
        slack_bot_token?: string,
        team_id?: string,
    }) {
        let slackClient: WebClient|undefined;
        let room: BridgedRoom;
        let teamEntry: TeamEntry|null = null;
        let teamId: string = opts.team_id!;

        const matrixRoomId = opts.matrix_room_id;
        const existingChannel = opts.slack_channel_id ? this.rooms.getBySlackChannelId(opts.slack_channel_id) : null;
        const existingRoom = this.rooms.getByMatrixRoomId(matrixRoomId);

        if (existingChannel) {
            throw Error("Channel is already bridged! Unbridge the channel first.");
        }

        if (!opts.team_id && !opts.slack_bot_token) {
            if (!opts.slack_webhook_uri) {
                throw Error("Neither a team_id nor a slack_bot_token were provided");
            }
        }

        if (opts.slack_bot_token) {
            if (!opts.slack_bot_token.startsWith("xoxb-")) {
                throw Error("Provided token is not a bot token. Ensure the token starts with xoxb-");
            }
            // We may have this team already and want to update the token, or this might be new.
            // Budisallow_direct_messages.slack first check that the token works.
            try {
                teamId = await this.clientFactory.upsertTeamByToken(opts.slack_bot_token);
                log.info(`Found ${teamId} for token`);
            } catch (ex) {
                log.error("Failed to action link because the token couldn't used:", ex);
                throw Error("Token did not work, unable to get team");
            }
        }

        // else, assume we have a teamId
        if (teamId) {
            try {
                slackClient = await this.clientFactory.getTeamClient(teamId);
            } catch (ex) {
                log.error("Failed to action link because the team client couldn't be fetched:", ex);
                throw Error("Team is known, but unable to get team client");
            }

            teamEntry = await this.datastore.getTeam(teamId);
            if (!teamEntry) {
                throw Error("Team ID provided, but no team found in database");
            }
        }

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
                slack_team_id: teamId,
                is_private: false,
                slack_type: "unknown", // Set below.
            }, teamEntry || undefined, slackClient);
            isNew = true;
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

        if (!room.SlackChannelId && !room.SlackWebhookUri) {
            throw Error("Missing webhook_id OR channel_id");
        }

        if (slackClient && opts.slack_channel_id && opts.team_id) {
            // PSA: Bots cannot join channels, they have a limited set of APIs https://api.slack.com/methods/bots.info

            const infoRes = (await slackClient.conversations.info({ channel: opts.slack_channel_id})) as ConversationsInfoResponse;
            if (!infoRes.ok) {
                log.error(`conversations.info for ${opts.slack_channel_id} errored:`, infoRes.error);
                throw Error("Failed to get channel info");
            }
            room.updateUsingChannelInfo(infoRes);
            room.setBotClient(slackClient);
            room.SlackChannelName = infoRes.channel.name;
        }

        if (isNew) {
            await this.addBridgedRoom(room);
        }
        if (room.isDirty) {
            await this.datastore.upsertRoom(room);
        }

        if (this.slackRtm && !room.SlackWebhookUri) {
            await this.slackRtm.startTeamClientIfNotStarted(room.SlackTeamId!);
        }


        if (slackClient && opts.slack_channel_id && opts.team_id) {
            // Perform syncing asynchronously.
            this.teamSyncer?.syncMembershipForRoom(matrixRoomId, opts.slack_channel_id, opts.team_id, slackClient).catch((ex) => {
                log.warn(`Failed to sync membership for ${opts.slack_channel_id}:`, ex);
            });
        }

        return room;
    }

    public async actionUnlink(opts: {
        matrix_room_id: string,
    }) {
        log.warn(`Trying to unlink ${opts.matrix_room_id}`);
        const room = this.rooms.getByMatrixRoomId(opts.matrix_room_id);
        if (!room) {
            throw Error("Cannot unlink - unknown channel");
        }

        this.rooms.removeRoom(room);
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

    public async setUserAccessToken(userId: string, teamId: string, slackId: string, accessToken: string, puppeting: boolean) {
        await this.datastore.insertAccount(userId, slackId, teamId, accessToken);
        if (puppeting) {
            // Store it here too for puppeting.
            await this.datastore.setPuppetToken(teamId, slackId, userId, accessToken);
            await this.slackRtm!.startUserClient({
                teamId,
                slackId,
                matrixId: userId,
                token: accessToken,
            });
        }
        log.info(`Set new access token for ${userId} (team: ${teamId}, puppeting: ${puppeting})`);
    }

    public async matrixUserInSlackTeam(teamId: string, userId: string) {
        return (await this.datastore.getAccountsForMatrixUser(userId)).find((a) => a.teamId === teamId);
    }

    public async willExceedTeamLimit(teamId: string) {
        // First, check if we are limited
        if (!this.config.provisioning?.limits?.team_count) {
            return false;
        }
        const idSet = new Set((await this.datastore.getAllTeams()).map((t) => t.id));
        return idSet.add(teamId).size > this.config.provisioning?.limits?.team_count;
    }

    public async logoutAccount(userId: string, slackId: string) {
        const acct = (await this.datastore.getAccountsForMatrixUser(userId)).find((s) => s.slackId === slackId);
        if (!acct) {
            // Account not found
            return { deleted: false, msg: "Account not found"};
        }

        const isLastAccountForTeam = !acct.teamId || (await this.datastore.getAccountsForTeam(acct.teamId)).length <= 1;
        const teamHasRooms = this.rooms.getBySlackTeamId(acct.teamId).length > 0;

        if (isLastAccountForTeam) {
            if (teamHasRooms) {
                // If this is the last account for a team and rooms are bridged, we must preserve
                // the team until all rooms are removed.
                return { deleted: false, msg: "You are the only user connected to Slack. You must unlink your rooms before you can unlink your account"};
            }
            // Last account, but no bridged rooms. We can delete the team safely.
            await this.clientFactory.dropTeamClient(acct.teamId);
            await this.datastore.deleteTeam(acct.teamId);
            log.info(`Removed team ${acct.teamId}`);
        } // or not even the last account, we can safely remove the team

        try {
            const client = await this.clientFactory.createClient(acct.accessToken);
            await client.auth.revoke();
        } catch (ex) {
            log.warn('Tried to revoke auth token, but got:', ex);
            // Even if this fails, we remove the token locally.
        }

        await this.datastore.deleteAccount(userId, slackId);
        log.info(`Removed account ${slackId} from ${slackId}`);
        return { deleted: true };
    }

    public async killBridge() {
        log.info("Killing bridge");
        if (this.metricsCollectorInterval) {
            clearInterval(this.metricsCollectorInterval);
        }
        if (this.slackRtm) {
            log.info("Closing RTM connections");
            await this.slackRtm.disconnectAll();
        }
        log.info("Closing appservice");
        await this.appservice.close();
        log.info("Bridge killed");
    }

    private async onRoomUpgrade(oldRoomId: string, newRoomId: string) {
        log.info(`Room has been upgraded from ${oldRoomId} to ${newRoomId}`);
        const bridgedroom = this.rooms.getByMatrixRoomId(oldRoomId);
        const adminRoomUser = await this.datastore.getUserForAdminRoom(oldRoomId);
        if (bridgedroom) {
            log.info("Migrating channel");
            this.rooms.removeRoom(bridgedroom);
            bridgedroom.migrateToNewRoomId(newRoomId);
            this.rooms.upsertRoom(bridgedroom);
            await this.datastore.upsertRoom(bridgedroom);
        } else if (adminRoomUser) {
            log.info("Migrating admin room");
            await this.datastore.setUserAdminRoom(adminRoomUser, newRoomId);
        } // Otherwise, not a known room.
    }

    private onHealthProbe(_, res: Response) {
        res.status(201).send("");
    }

    private onReadyProbe(_, res: Response) {
        res.status(this.ready ? 201 : 425).send("");
    }
}
