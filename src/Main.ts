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

import {
    Bridge, BridgeBlocker, PrometheusMetrics, StateLookup,
    Logger, Intent, UserMembership, WeakEvent, PresenceEvent,
    AppService, AppServiceRegistration, UserActivityState, UserActivityTracker,
    UserActivityTrackerConfig, MembershipQueue, PowerLevelContent, StateLookupEvent } from "matrix-appservice-bridge";
import { Gauge, Counter } from "prom-client";
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
import { Provisioner } from "./provisioning/Provisioner";
import { INTERNAL_ID_LEN } from "./BaseSlackHandler";
import { SlackRTMHandler } from "./SlackRTMHandler";
import { ConversationsInfoResponse, ConversationsOpenResponse, AuthTestResponse, UsersInfoResponse } from "./SlackResponses";
import { Datastore, RoomEntry, SlackAccount, TeamEntry } from "./datastore/Models";
import { NedbDatastore } from "./datastore/NedbDatastore";
import { PgDatastore } from "./datastore/postgres/PgDatastore";
import { SlackClientFactory } from "./SlackClientFactory";
import { Response } from "express";
import { SlackRoomStore } from "./SlackRoomStore";
import QuickLRU from "@alloc/quick-lru";
import PQueue from "p-queue";
import { UserAdminRoom } from "./rooms/UserAdminRoom";
import { TeamSyncer } from "./TeamSyncer";
import { SlackGhostStore } from "./SlackGhostStore";
import { AllowDenyList, DenyReason } from "./AllowDenyList";

const log = new Logger("Main");

const STARTUP_TEAM_INIT_CONCURRENCY = 10;
const STARTUP_RETRY_TIME_MS = 5000;
export const METRIC_ACTIVE_USERS = "active_users";
export const METRIC_ACTIVE_ROOMS = "active_rooms";
export const METRIC_PUPPETS = "remote_puppets";
export const METRIC_RECEIVED_MESSAGE = "received_messages";
export const METRIC_SENT_MESSAGES = "sent_messages";
export const METRIC_OAUTH_SESSIONS = "oauth_session_result";

export interface ISlackTeam {
    id: string;
    domain: string;
    name: string;
}

interface MetricsLabels { [labelName: string]: string; }

type TimerFunc = (labels?: Partial<Record<string, string | number>> | undefined) => void;

class SlackBridgeBlocker extends BridgeBlocker {
    constructor(userLimit: number, private slackBridge: Main) {
        super(userLimit);
    }

    async blockBridge() {
        log.info("Blocking the bridge");
        await this.slackBridge.disableHookHandler();
        await this.slackBridge.disableRtm();
        await super.blockBridge();
    }

    async unblockBridge() {
        log.info("Unblocking the bridge");
        if (this.slackBridge.config.rtm?.enable) {
            this.slackBridge.enableRtm();
        }
        if (this.slackBridge.config.slack_hook_port) {
            this.slackBridge.enableHookHandler();
        }
        await super.unblockBridge();
    }
}

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

    public readonly rooms: SlackRoomStore = new SlackRoomStore();
    private ghosts!: SlackGhostStore; // Defined in .run

    private matrixUsersById: QuickLRU<string, MatrixUser>;

    private bridge: Bridge;
    private appservice: AppService;
    private ready = false;

    // TODO(paul): ugh. this.getBotIntent() doesn't work before .run time
    // So we can't create the StateLookup instance yet
    private stateStorage: StateLookup|null = null;

    private metrics?: {
        prometheus: PrometheusMetrics;
        metricActiveRooms: Gauge<string>;
        metricActiveUsers: Gauge<string>;
        metricPuppets: Gauge<string>;
        bridgeBlocked: Gauge<string>;
        oauthSessions: Counter<string>;
    };
    private metricsCollectorInterval?: NodeJS.Timeout;

    private adminCommands: AdminCommands;
    private clientfactory!: SlackClientFactory;
    public readonly teamSyncer?: TeamSyncer;
    public readonly allowDenyList: AllowDenyList;

    public slackRtm?: SlackRTMHandler;
    private slackHookHandler?: SlackHookHandler;

    private provisioner: Provisioner;

    private bridgeBlocker?: BridgeBlocker;

    public readonly membershipQueue: MembershipQueue;

    constructor(public readonly config: IConfig, registration: AppServiceRegistration) {
        this.adminCommands = new AdminCommands(this);

        if (config.oauth2) {
            const redirectPrefix = config.oauth2.redirect_prefix || config.inbound_uri_prefix;
            if (!redirectPrefix) {
                throw Error("Either inbound_uri_prefix or oauth2.redirect_prefix must be defined for oauth2 support");
            }
            this.oauth2 = new OAuth2({
                client_id: config.oauth2.client_id,
                client_secret: config.oauth2.client_secret,
                main: this,
                redirect_prefix: redirectPrefix,
                template_file: config.oauth2.html_template || path.join(__dirname, ".." , "templates/oauth_result.html.njk"),
            });
        }

        config.caching = { ...CACHING_DEFAULTS, ...config.caching };

        this.matrixUsersById = new QuickLRU({ maxSize: config.caching.matrixUserCache });

        if ((!config.rtm || !config.rtm.enable) && (!config.slack_hook_port || !config.inbound_uri_prefix)) {
            throw Error("Neither rtm.enable nor slack_hook_port|inbound_uri_prefix is defined in the config." +
            "The bridge must define a listener in order to run");
        }

        if ((!config.rtm?.enable || !config.oauth2) && config.puppeting?.enabled) {
            throw Error("Either rtm and/or oauth2 is not enabled, but puppeting is enabled. Both need to be enabled for puppeting to work.");
        }

        let bridgeStores = {};
        const usingNeDB = config.db === undefined || config.db?.engine === "nedb";
        if (usingNeDB) {
            const dbdir = config.dbdir || "";
            const URL = "https://github.com/matrix-org/matrix-appservice-slack/blob/master/docs/datastores.md";
            log.warn("** NEDB IS END-OF-LIFE **");
            log.warn("Starting with version 1.0, the nedb datastore is being discontinued in favour of " +
                     `postgresql. Please see ${URL} for more information.`);
            if (config.rmau_limit) {
                throw new Error("RMAU limits are unsupported in NeDB, cannot continue");
            }
            bridgeStores = {
                eventStore: path.join(dbdir, "event-store.db"),
                roomStore: path.join(dbdir, "room-store.db"),
                userStore: path.join(dbdir, "user-store.db"),
            };
        } else {
            bridgeStores = {
                // Don't create store
                disableStores: true,
            };
        }

        if (config.db?.engine === "postgres") {
            // Need to create this early for encryption support
            const postgresDb = new PgDatastore(config.db.connectionString);
            this.datastore = postgresDb;
        }

        if (config.encryption?.enabled && config.db?.engine !== "postgres") {
            throw Error('Encrypted bridge support only works with PostgreSQL.');
        }

        this.bridge = new Bridge({
            controller: {
                onEvent: (request) => {
                    const ev = request.getData();
                    const isAdminRoomRelated = UserAdminRoom.IsAdminRoomInvite(ev, this.botUserId)
                        || ev.room_id === this.config.matrix_admin_room;
                    if (this.bridgeBlocker?.isBlocked && !isAdminRoomRelated) {
                        log.info(`Bridge is blocked, dropping Matrix event ${ev.event_id} (${ev.room_id})`);
                        return;
                    }
                    if (ev.state_key) {
                        this.stateStorage?.onEvent({
                            ...ev,
                            state_key: ev.state_key as string,
                        }).catch((ex) => {
                            log.error(`Failed to store event in stateStorage ${ev.event_id} (${ev.room_id})`, ex);
                        });
                    }
                    this.onMatrixEvent(ev).then(() => {
                        log.info(`Handled ${ev.event_id} (${ev.room_id})`);
                    }).catch((ex) => {
                        log.error(`Failed to handle ${ev.event_id} (${ev.room_id})`, ex);
                    });
                },
                onEphemeralEvent: request => {
                    if (this.bridgeBlocker?.isBlocked) {
                        log.info('Bridge is blocked, dropping Matrix ephemeral event');
                        return;
                    }
                    const ev = request.getData();
                    if (ev.type === "m.typing") {
                        const room = this.rooms.getByMatrixRoomId(ev.room_id);
                        if (room) {
                            room.onMatrixTyping(ev.content.user_ids).then(() => {
                                log.debug(`Handled typing event for ${ev.room_id}`);
                            }).catch((ex) => {
                                log.error(`Failed handle typing event for room ${room.MatrixRoomId}`, ex);
                            });
                        }
                    } else if (ev.type === "m.presence") {
                        this.onMatrixPresence(ev).then(() => {
                            log.debug(`Handled presence for ${ev.sender} (${ev.content.presence})`);
                        }).catch((ex) => {
                            log.error(`Failed handle presence for ${ev.sender}`, ex);
                        });
                    }
                    // Slack has no concept of receipts, we can't bridge those.

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
            suppressEcho: true,
            bridgeEncryption: config.encryption?.enabled ? {
                homeserverUrl: config.encryption.pantalaimon_url,
                store: this.datastore as PgDatastore,
            } : undefined,
        });
        this.membershipQueue = new MembershipQueue(this.bridge, { });

        if (config.rtm?.enable) {
            this.enableRtm();
        }

        if (config.slack_hook_port) {
            this.enableHookHandler();
        }

        if (config.rmau_limit) {
            this.bridgeBlocker = new SlackBridgeBlocker(config.rmau_limit, this);
        }

        if (config.enable_metrics) {
            this.initialiseMetrics();
        }

        if (config.team_sync) {
            this.teamSyncer = new TeamSyncer(this);
        }

        this.allowDenyList = new AllowDenyList(
            config.puppeting?.direct_messages,
            config.provisioning?.channel_adl,
        );

        const homeserverToken = registration.getHomeserverToken();
        if (homeserverToken === null) {
            throw Error("Homeserver token is null");
        }

        this.appservice = new AppService({
            homeserverToken,
            httpMaxSizeBytes: 0,
        });

        this.provisioner = new Provisioner(
            this,
            this.appservice,
            {
                // Default to HS token if no secret is configured
                secret: homeserverToken,
                ...(config.provisioning ?? { enabled: true }),
            },
        );
    }

    public teamIsUsingRtm(teamId: string): boolean {
        return (this.slackRtm !== undefined) && this.slackRtm.teamIsUsingRtm(teamId);
    }

    public getIntent(userId: string): Intent {
        return this.bridge.getIntent(userId);
    }

    public initialiseMetrics(): void {
        // Do not set up the handler here, we set it up after listening.
        const prometheus = this.bridge.getPrometheusMetrics();

        this.bridge.registerBridgeGauges(() => {
            const now = Date.now() / 1000;

            const remoteRoomsByAge = new PrometheusMetrics.AgeCounters();
            const matrixRoomsByAge = new PrometheusMetrics.AgeCounters();

            this.rooms.all.forEach((room) => {
                if (room.RemoteATime) {
                    remoteRoomsByAge.bump(now - room.RemoteATime);
                }
                if (room.MatrixATime) {
                    matrixRoomsByAge.bump(now - room.MatrixATime);
                }
            });

            const countAges = (users: QuickLRU<string, MatrixUser|SlackGhost>) => {
                const counts = new PrometheusMetrics.AgeCounters();
                const snapshot = [...users.values()].filter((u) => u !== undefined && u.aTime && u.aTime > 0);
                for (const user of snapshot) {
                    if (user.aTime) {
                        counts.bump(now - user.aTime);
                    }
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

        prometheus.addCounter({
            help: "count of received messages",
            labels: ["side"],
            name: METRIC_RECEIVED_MESSAGE,
        });
        prometheus.addCounter({
            help: "count of sent messages",
            labels: ["side"],
            name: METRIC_SENT_MESSAGES,
        });
        prometheus.addCounter({
            help: "Count of the number of remote API calls made",
            labels: ["method"],
            name: "remote_api_calls",
        });
        prometheus.addTimer({
            help: "Histogram of processing durations of received Matrix messages",
            labels: ["outcome"],
            name: "matrix_request_seconds",
        });
        prometheus.addTimer({
            help: "Histogram of processing durations of received remote messages",
            labels: ["outcome"],
            name: "remote_request_seconds",
        });
        const metricActiveUsers = prometheus.addGauge({
            help: "Count of active users",
            labels: ["remote", "team_id"],
            name: METRIC_ACTIVE_USERS,
        });
        const metricActiveRooms = prometheus.addGauge({
            help: "Count of active bridged rooms (types are 'channel' and 'user')",
            labels: ["team_id", "type"],
            name: METRIC_ACTIVE_ROOMS,
        });
        const metricPuppets = prometheus.addGauge({
            help: "Amount of puppeted users on the remote side of the bridge",
            labels: ["team_id"],
            name: METRIC_PUPPETS,
        });
        const bridgeBlocked = prometheus.addGauge({
            name: "blocked",
            help: "Is the bridge currently blocking messages",
        });
        const oauthSessions = prometheus.addCounter({
            name: METRIC_OAUTH_SESSIONS,
            help: "Metric tracking the result of oauth sessions",
            labels: ["result", "reason"],
        });

        this.metrics = {
            prometheus,
            metricActiveUsers,
            metricActiveRooms,
            metricPuppets,
            bridgeBlocked,
            oauthSessions,
        };
        log.info(`Enabled prometheus metrics`);
    }

    public incCounter(name: string, labels: MetricsLabels = {}): void {
        this.metrics?.prometheus.incCounter(name, labels);
    }

    public incRemoteCallCounter(type: string): void {
        this.metrics?.prometheus.incCounter("remote_api_calls", {method: type});
    }

    /**
     * Gathers the active rooms and users from the database and updates the metrics.
     * This function should be called on a regular interval or after an important
     * change to the metrics has happened.
     */
    public async updateActivityMetrics(): Promise<void> {
        if (!this.metrics) {
            return;
        }
        const roomsByTeamAndType = await this.datastore.getActiveRoomsPerTeam();
        const usersByTeamAndRemote = await this.datastore.getActiveUsersPerTeam();

        this.metrics.metricActiveRooms.reset();
        for (const [teamId, teamData] of roomsByTeamAndType.entries()) {
            for (const [roomType, numberOfActiveRooms] of teamData.entries()) {
                this.metrics.metricActiveRooms.set({ team_id: teamId, type: roomType }, numberOfActiveRooms);
            }
        }

        this.metrics.metricActiveUsers.reset();
        for (const [teamId, teamData] of usersByTeamAndRemote.entries()) {
            this.metrics.metricActiveUsers.set({ team_id: teamId, remote: "true" }, teamData.get(true) || 0);
            this.metrics.metricActiveUsers.set({ team_id: teamId, remote: "false" }, teamData.get(false) || 0);
        }
        this.metrics.bridgeBlocked.set(this.bridgeBlocker?.isBlocked ? 1 : 0);
    }

    public startTimer(name: string, labels: MetricsLabels = {}): TimerFunc {
        return this.metrics ? this.metrics.prometheus.startTimer(name, labels) : () => {};
    }

    public getUrlForMxc(mxcUrl: string, local = false): string {
        // Media may be encrypted, use this.
        let baseUrl = this.config.homeserver.url;
        if (this.config.encryption?.enabled && local) {
            baseUrl = this.config.encryption?.pantalaimon_url;
        } else if (this.config.homeserver.media_url) {
            baseUrl = this.config.homeserver.media_url;
        }
        return `${baseUrl}/_matrix/media/r0/download/${mxcUrl.slice("mxc://".length)}`;
    }

    public async getTeamDomainForMessage(message: {team_domain?: string, team_id?: string}, teamId?: string): Promise<string|undefined> {
        if (typeof message.team_domain === 'string') {
            return message.team_domain;
        }

        if (!teamId) {
            if (!message.team_id) {
                throw Error("Cannot determine team, no id given.");
            } else if (typeof message.team_id !== 'string') {
                throw Error("Cannot determine team, id is invalid.");
            }
            teamId = message.team_id;
        }

        const team = await this.datastore.getTeam(teamId);
        if (team) {
            return team.domain;
        }
    }

    public getOrCreateMatrixUser(id: string): MatrixUser {
        let u = this.matrixUsersById.get(id);
        if (u) {
            return u;
        }
        u = new MatrixUser(this, {user_id: id});
        this.matrixUsersById.set(id, u);
        return u;
    }

    public genInboundId(): string {
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

    public async addBridgedRoom(room: BridgedRoom): Promise<void> {
        this.rooms.upsertRoom(room);
        if (this.slackRtm && room.SlackTeamId) {
            // This will start a new RTM client for the team, if the team
            // doesn't currently have a client running.
            await this.slackRtm.startTeamClientIfNotStarted(room.SlackTeamId);
        }
    }

    public async fixDMMetadata(room: BridgedRoom, targetSlackRecipient: SlackGhost) {
        if (room.SlackType !== "im" || !room.SlackTeamId) {
            return;
        }
        const puppetedSlackGhosts: SlackGhost[] = [];
        const otherSlackGhosts: SlackGhost[] = [];
        for (const userId of await this.listGhostUsers(room.MatrixRoomId)) {
            const slackGhost = await this.ghosts.getExisting(userId);
            if (!slackGhost) {
                log.warn(`Could not find Slack ghost for ${userId} in DM ${room.MatrixRoomId}`);
                continue;
            }
            const puppetMatrixUser = await this.datastore.getPuppetMatrixUserBySlackId(room.SlackTeamId, slackGhost.slackId);
            if (puppetMatrixUser) {
                puppetedSlackGhosts.push(slackGhost);
            } else {
                otherSlackGhosts.push(slackGhost);
            }
        }

        const allSlackGhosts = otherSlackGhosts.concat(puppetedSlackGhosts);
        if (otherSlackGhosts.length !== 1 && puppetedSlackGhosts.length !== 1) {
            log.warn(
                `Cannot update metadata of DM ${room.MatrixRoomId} ` +
                `with ${!allSlackGhosts.length ? "no" : "multiple"} potential Slack recipients`,
                allSlackGhosts.map(r => r.matrixUserId).join(","));
            return;
        }

        const slackRecipient = otherSlackGhosts.length ? otherSlackGhosts[0] : puppetedSlackGhosts[0];
        if (slackRecipient.slackId !== targetSlackRecipient.slackId) {
            log.debug(
                `Not updating metadata of DM ${room.MatrixRoomId} ` +
                `not owned by Slack user ${targetSlackRecipient.slackId}`);
            return;
        }

        const profileInfo = await targetSlackRecipient.intent.getProfileInfo(targetSlackRecipient.matrixUserId);
        for (const slackGhost of allSlackGhosts) {
            try {
                const intent = this.getIntent(slackGhost.matrixUserId);
                if (profileInfo.displayname) {
                    await intent.setRoomName(room.MatrixRoomId, profileInfo.displayname);
                }
                if (profileInfo.avatar_url) {
                    await intent.setRoomAvatar(room.MatrixRoomId, profileInfo.avatar_url);
                }
                break;
            } catch (ex) {
                // TODO Use MatrixError and break if error is due to something other than power levels
                log.warn(ex);
            }
        }
    }

    public getInboundUrlForRoom(room: BridgedRoom): string {
        return this.config.inbound_uri_prefix + room.InboundId;
    }

    public getStoredEvent(roomId: string, eventType: string, stateKey?: string): StateLookupEvent|StateLookupEvent[]|null|undefined {
        return this.stateStorage?.getState(roomId, eventType, stateKey);
    }

    public async getState(roomId: string, eventType: string): Promise<unknown> {
        const cachedEvent = this.getStoredEvent(roomId, eventType, "");
        if (cachedEvent && Array.isArray(cachedEvent) && cachedEvent.length) {
            // StateLookup returns entire state events. client.getStateEvent returns
            //   *just the content*
            return cachedEvent[0].content;
        }

        return this.botIntent.getStateEvent(roomId, eventType, undefined, true);
    }

    public async listAllUsers(roomId: string): Promise<string[]> {
        const members = await this.bridge.getBot().getJoinedMembers(roomId);
        return Object.keys(members);
    }

    public async listGhostUsers(roomId: string): Promise<string[]> {
        const userIds = await this.listAllUsers(roomId);
        const regexp = new RegExp("^@" + this.config.username_prefix);
        return userIds.filter((i) => i.match(regexp));
    }

    public async drainAndLeaveMatrixRoom(roomId: string): Promise<void> {
        const userIds = await this.listGhostUsers(roomId);
        log.info(`Draining ${userIds.length} ghosts from ${roomId}`);
        const intents = userIds.map(userId => this.getIntent(userId));
        intents.push(this.botIntent);
        await Promise.allSettled(intents.map(async (intent) => intent.leave(roomId)));
    }

    public async listRoomsFor(): Promise<string[]> {
        return this.bridge.getBot().getJoinedRooms();
    }

    private async handleMatrixMembership(ev: {
        event_id: string,
        state_key: string,
        type: string,
        room_id: string,
        sender: string,
        content: {
            is_direct?: boolean;
            membership: UserMembership;
        }
    }, room: BridgedRoom | undefined, endTimer: TimerFunc) {
        const bot = this.bridge.getBot();

        const senderIsRemote = bot.isRemoteUser(ev.sender);
        const recipientIsRemote = bot.isRemoteUser(ev.state_key);

        // Bot membership
        if (ev.state_key === this.botUserId) {
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
                    await this.stateStorage?.trackRoom(ev.room_id);
                }
            } else if (membership === "leave" || membership === "ban") {
                // We've been kicked out :(
                if (forRoom) {
                    forRoom.MatrixRoomActive = false;
                    this.stateStorage?.untrackRoom(ev.room_id);
                }
            }
            endTimer({ outcome: "success" });
            return;
        }

        // Matrix User -> Remote user
        if (!senderIsRemote && recipientIsRemote) {
            if (ev.content.is_direct) {
                // DM
                try {
                    await this.handleDmInvite(ev.state_key, ev.sender, ev.room_id);
                    endTimer({ outcome: "success" });
                } catch (e) {
                    log.error("Failed to handle DM invite: ", e);
                    endTimer({ outcome: "fail" });
                }
            } else if (room) {
                // Normal invite
                await room.onMatrixInvite(ev.sender, ev.state_key);
                endTimer({ outcome: "success" });
            }
            return;
        }

        if (!room) {
            // We can't do anything else without a room
            return;
        }

        // Regular membership from matrix user
        if (!senderIsRemote) {
            const membership = ev.content.membership;
            if (membership === "join") {
                await room.onMatrixJoin(ev.state_key);
                // Do we need to onboard this user?
                if (this.config.puppeting?.enabled && this.config.puppeting.onboard_users) {
                    const adminRoomUser = await this.datastore.getUserAdminRoom(ev.state_key);
                    const puppets = await this.datastore.getPuppetsByMatrixId(ev.state_key);
                    if (!adminRoomUser && puppets.length === 0) {
                        // No admin room, and no puppets but just joined a Slack room.
                        await UserAdminRoom.inviteAndCreateAdminRoom(ev.state_key, this);
                    }
                }
            } else if (membership === "leave" || membership === "ban") {
                await room.onMatrixLeave(ev.state_key);
            }
            // Invites are not handled
        }
    }

    public async onMatrixEvent(ev: WeakEvent): Promise<void> {
        if (ev.sender === this.botUserId) {
            // We don't want to handle echo.
            return;
        }

        this.incCounter(METRIC_RECEIVED_MESSAGE, {side: "matrix"});
        const endTimer = this.startTimer("matrix_request_seconds");

        // Admin room message
        if (ev.room_id === this.config.matrix_admin_room &&
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

        const room = this.rooms.getByMatrixRoomId(ev.room_id);
        if (ev.type === "m.room.member") {
            const stateKey = ev.state_key;
            if (stateKey !== undefined) {
                await this.handleMatrixMembership({
                    ...ev,
                    content: {
                        membership: ev.content.membership as UserMembership,
                        is_direct: ev.content.is_direct as boolean|undefined,
                    },
                    state_key: stateKey,
                }, room, endTimer);
            }
            return;
        }

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
                    await adminRoom.handleEvent({
                        type: ev.type,
                        content: {
                            msgtype: ev.content.msgtype as string,
                            body: ev.content.body as string,
                        }
                    });
                    endTimer({outcome: "success"});
                } catch (ex) {
                    log.error("Failed to handle admin mesage:", ex);
                    endTimer({outcome: "dropped"});
                }
                return;
            }
            log.warn(`Ignoring ev for matrix room with unknown slack channel: ${ev.room_id}`);
            endTimer({outcome: "dropped"});
            return; // Can't do anything without a room.
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
            const relatesTo = ev.content["m.relates_to"] as {rel_type: string, event_id: string};
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

    public async handleDmInvite(recipient: string, sender: string, roomId: string): Promise<void> {
        const intent = this.getIntent(recipient);
        await intent.join(roomId);
        if (!this.slackRtm) {
            await intent.sendEvent(roomId, "m.room.message", {
                body: "This slack bridge instance doesn't support private messaging.",
                msgtype: "m.notice",
            });
            await intent.leave(roomId);
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
        const rtmClient = this.slackRtm && await this.slackRtm.getUserClient(teamId, sender);
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
        const denyReason = this.allowDenyList.allowDM(sender, slackGhost.slackId, userData.user?.name);
        if (denyReason !== DenyReason.ALLOWED) {
            await intent.sendEvent(roomId, "m.room.message", {
                body: denyReason === DenyReason.MATRIX ? "The admin of this Slack bridge has denied you to directly message Slack users." :
                    "The admin of this Slack bridge has denied users to directly message this Slack user.",
                msgtype: "m.notice",
            });
            await intent.leave(roomId);
            return;
        }

        const openResponse = (await slackClient.conversations.open({users: slackGhost.slackId, return_im: true})) as ConversationsOpenResponse;
        if (openResponse.already_open) {
            // Check to see if we have a room for this channel already.
            const existing = this.rooms.getBySlackChannelId(openResponse.channel.id);
            if (existing) {
                await intent.sendEvent(roomId, "m.room.message", {
                    body: "You already have a conversation open with this person, leaving that room and reattaching here.",
                    msgtype: "m.notice",
                });
                try {
                    await intent.setRoomName(existing.MatrixRoomId, "");
                    await intent.setRoomAvatar(existing.MatrixRoomId, "");
                } catch (ex) {
                    log.error("Failed to clear name of now-empty DM", ex);
                }
                await this.actionUnlink({ matrix_room_id: existing.MatrixRoomId });
            }
        }
        const puppetIdent = (await slackClient.auth.test()) as AuthTestResponse;
        const team = await this.datastore.getTeam(teamId);
        if (!team) {
            throw Error(`Expected team ${teamId} for DM to be in datastore`);
        }
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
        }, team , slackClient);
        room.updateUsingChannelInfo(openResponse);
        await this.addBridgedRoom(room);
        await this.datastore.upsertRoom(room);
        await intent.join(roomId);

        const profileInfo = await intent.getProfileInfo(slackGhost.matrixUserId);
        try {
            if (profileInfo.displayname) {
                await intent.setRoomName(room.MatrixRoomId, profileInfo.displayname);
            }
            if (profileInfo.avatar_url) {
                await intent.setRoomAvatar(room.MatrixRoomId, profileInfo.avatar_url);
            }
        } catch (ex) {
            log.warn("Unable to set metadata of newly-joined DM", ex);
        }
    }

    public async onMatrixAdminMessage(ev: {
        event_id: string,
        state_key?: string,
        type: string,
        room_id: string,
        sender: string,
        content?: {
            body?: unknown,
        },
    }): Promise<void> {
        if (typeof ev.content !== "object" || !ev.content || typeof ev.content.body !== "string") {
            throw Error("Received an invalid Matrix admin message. event.content.body was not a string.");
        }

        const cmd = ev.content.body;

        // Ignore "# comment" lines as chatter between humans sharing the console
        if (cmd.match(/^\s*#/))  {
            return;
        }

        let response: string[] | null = [];
        const respond = (responseMsg: string) => {
            if (!response) {
                log.info(`Command response too late: ${responseMsg}`);
                return;
            }
            response.push(responseMsg);
        };

        const waiter = this.adminCommands.parse(cmd, respond, ev.sender);
        try {
            await waiter;
            if (response.length === 0) {
                respond("Done");
            }
        } catch (ex) {
            log.warn(`Command '${cmd}' failed to complete:`, ex);
            respond(`${ex instanceof Error ? ex.message : "Command failed: See the logs for details."}`);
        }

        const message = response.join("\n");
        response = null;

        await this.botIntent.sendEvent(ev.room_id, "m.room.message", {
            body: message,
            msgtype: "m.notice",
        });
    }

    /**
     * Ensures the bridge bot is registered and updates its profile info.
     */
    private async applyBotProfile() {
        log.info("Ensuring the bridge bot is registered");
        const intent = this.botIntent;
        await intent.ensureRegistered(true);
        const profile = await intent.getProfileInfo(this.botUserId);
        if (this.config.bot_profile?.displayname && profile.displayname !== this.config.bot_profile.displayname) {
            await intent.setDisplayName(this.config.bot_profile.displayname);
        }
        if (this.config.bot_profile?.avatar_url && profile.avatar_url !== this.config.bot_profile.avatar_url) {
            await intent.setAvatarUrl(this.config.bot_profile.avatar_url);
        }
    }

    /**
     * Starts the bridge.
     * @param cliPort A port to listen to provided by the user via a CLI option.
     * @returns The port the appservice listens to.
     */
    public async run(port: number): Promise<number> {
        await this.bridge.initialise();

        log.info("Loading databases");
        if (this.oauth2) {
            await this.oauth2.compileTemplates();
        }

        await UserAdminRoom.compileTemplates();

        if (this.datastore instanceof PgDatastore) {
            // We create this in the constructor because we need it for encryption
            // support.
            const userMessages = await this.datastore.ensureSchema();
            for (const message of userMessages) {
                let roomId = await this.datastore.getUserAdminRoom(message.matrixId);
                if (!roomId) {
                    // Unexpected, they somehow set up a puppet without creating an admin room.
                    roomId = (await UserAdminRoom.inviteAndCreateAdminRoom(message.matrixId, this)).roomId;
                }
                log.info(`Sending one-time notice from schema to ${message.matrixId} (${roomId})`);
                await this.botIntent.sendText(roomId, message.message);
            }
        } else if (!this.config.db || this.config.db.engine === "nedb") {
            await this.bridge.loadDatabases();
            log.info("Loading teams.db");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const NedbDs = require("nedb");
            const teamDatastore = new NedbDs({
                autoload: true,
                filename: path.join(this.config.dbdir || "", "teams.db"),
            });
            await new Promise<void>((resolve, reject) => {
                teamDatastore.loadDatabase(err => err ? reject(err) : resolve());
            });
            const reactionDatastore = new NedbDs({
                autoload: true,
                filename: path.join(this.config.dbdir || "", "reactions.db"),
            });
            await new Promise<void>((resolve, reject) => {
                reactionDatastore.loadDatabase(err => err ? reject(err) : resolve());
            });
            const userStore = this.bridge.getUserStore();
            const roomStore = this.bridge.getRoomStore();
            const eventStore = this.bridge.getEventStore();
            if (!userStore || !roomStore || !eventStore) {
                throw Error('Bridge stores are not defined');
            }
            this.datastore = new NedbDatastore(
                userStore,
                roomStore,
                eventStore,
                teamDatastore,
            );
        } else {
            throw Error("Unknown engine for database. Please use 'postgres' or 'nedb");
        }

        this.ghosts = new SlackGhostStore(this.rooms, this.datastore, this.config, this.bridge);

        this.clientfactory = new SlackClientFactory(this.datastore, this.config, (method: string) => {
            this.incRemoteCallCounter(method);
        }, (teamId: string, delta: number) => {
            this.metrics?.metricPuppets.inc({ team_id: teamId }, delta);
        });
        let puppetsWaiting: Promise<unknown> = Promise.resolve();
        if (this.slackRtm) {
            const puppetEntries = await this.datastore.getPuppetedUsers();
            puppetsWaiting = Promise.all(puppetEntries.map(async (entry) => {
                try {
                    if (this.slackRtm) {
                        await this.slackRtm.startUserClient(entry);
                    } else {
                        log.warn(`RTM not configured, not starting client for ${entry.matrixId} (${entry.slackId})`);
                    }
                } catch (ex) {
                    log.warn(`Failed to start puppet client for ${entry.matrixId}:`, ex);
                }
            }));
        }

        if (this.slackHookHandler) {
            if (!this.config.slack_hook_port) {
                throw Error('config option slack_hook_port must be defined');
            }
            await this.slackHookHandler.startAndListen(this.config.slack_hook_port, this.config.tls);
        }
        await this.bridge.listen(port, this.config.homeserver.appservice_host, undefined, this.appservice);
        this.bridge.addAppServicePath({
            handler: this.onReadyProbe.bind(this.bridge),
            method: "GET",
            authenticate: false,
            path: "/ready",
        });


        await this.pingBridge();

        this.stateStorage = new StateLookup({
            intent: this.botIntent,
            eventTypes: ["m.room.member", "m.room.power_levels"],
        });


        let joinedRooms: string[]|null = null;
        while(joinedRooms === null) {
            try {
                joinedRooms = await this.bridge.getBot().getJoinedRooms() as string[];
            } catch (ex) {
                const error = ex as {errcode?: string};
                if (error.errcode === 'M_UNKNOWN_TOKEN') {
                    log.error(
                        "The homeserver doesn't recognise this bridge, have you configured the homeserver with the appservice registration file?"
                    );
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
                        await this.slackRtm.startTeamClientIfNotStarted(team.id);
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
            log.info(`[${i+1}/${entries.length}] Loading room entry ${entry.matrix_id}`);
            try {
                await this.startupLoadRoomEntry(entry, joinedRooms as string[], teamClients);
            } catch (ex) {
                log.error(`Failed to load entry ${entry.matrix_id}, exception thrown`, ex);
            }
        }));

        const teamSyncPromise = this.teamSyncer ? this.teamSyncer.syncAllTeams(teamClients) : null;

        if (this.metrics) {
            // Regularly update the metrics for active rooms and users
            const ONE_HOUR = 60 * 60 * 1000;
            this.metricsCollectorInterval = setInterval(() => {
                log.info("Recalculating activity metrics...");
                this.updateActivityMetrics().catch((err) => {
                    log.error(`Error updating activity metrics`, err);
                });
            }, ONE_HOUR);
            await this.updateActivityMetrics();
        }

        // Start the provisioner API
        await this.provisioner.start();
        await puppetsWaiting;
        await teamSyncPromise;

        if (!(this.datastore instanceof NedbDatastore)) {
            const uatConfig = {
                ...UserActivityTrackerConfig.DEFAULT,
            };
            if (this.config.user_activity?.min_user_active_days !== undefined) {
                uatConfig.minUserActiveDays = this.config.user_activity.min_user_active_days;
            }
            if (this.config.user_activity?.inactive_after_days !== undefined) {
                uatConfig.inactiveAfterDays = this.config.user_activity.inactive_after_days;
            }
            this.bridge.opts.controller.userActivityTracker = new UserActivityTracker(
                uatConfig,
                await this.datastore.getUserActivity(),
                (changes) => {
                    this.onUserActivityChanged(changes).catch((ex) => {
                        log.warn(`Failed to run onUserActivityChanged`, ex);
                    });
                },
            );
            await this.bridgeBlocker?.checkLimits(this.bridge.opts.controller.userActivityTracker.countActiveUsers().allUsers);
        }

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
        const teamEntry = teamId && await this.datastore.getTeam(teamId) || undefined;
        let slackClient: WebClient|null = null;
        try {
            if (entry.remote.puppet_owner) {
                if (!entry.remote.slack_team_id) {
                    throw Error(`Expected ${entry.remote.slack_team_id} to be defined`);
                }
                // Puppeted room (like a DM)
                slackClient = await this.clientFactory.getClientForUser(entry.remote.slack_team_id, entry.remote.puppet_owner);
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
                await this.stateStorage?.trackRoom(entry.matrix_id);
            } catch (ex) {
                log.debug(`Could not track room state for ${entry.matrix_id}`, ex);
                this.stateStorage?.untrackRoom(entry.matrix_id);
                room.MatrixRoomActive = false;
            }
        }
    }

    public async getChannelInfo(
        slackChannelId: string,
        teamId: string,
    ): Promise<ConversationsInfoResponse|'channel_not_allowed'|'channel_not_found'> {
        let slackClient: WebClient;
        let teamEntry: TeamEntry|null = null;

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

        const channelInfo = (await slackClient.conversations.info({ channel: slackChannelId })) as ConversationsInfoResponse;
        if (!channelInfo.ok) {
            if (channelInfo.error === 'channel_not_found') {
                return 'channel_not_found';
            }
            log.error(`conversations.info for ${slackChannelId} errored:`, channelInfo.error);
            throw Error("Failed to get channel info");
        }

        if (this.allowDenyList.allowSlackChannel(slackChannelId, channelInfo?.channel.name) !== DenyReason.ALLOWED) {
            return 'channel_not_allowed';
        }

        return channelInfo;
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
    }): Promise<BridgedRoom> {
        let slackClient: WebClient|undefined;
        let room: BridgedRoom;
        let teamEntry: TeamEntry|null = null;
        let teamId: string|undefined = opts.team_id;

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
            // But first check that the token works.
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

        let channelInfo: ConversationsInfoResponse|undefined;
        if (slackClient && opts.slack_channel_id) {
            // PSA: Bots cannot join channels, they have a limited set of APIs https://api.slack.com/methods/bots.info

            channelInfo = (await slackClient.conversations.info({ channel: opts.slack_channel_id})) as ConversationsInfoResponse;
            if (!channelInfo.ok) {
                log.error(`conversations.info for ${opts.slack_channel_id} errored:`, channelInfo.error);
                throw Error("Failed to get channel info");
            }
        }

        if (opts.slack_channel_id &&
            this.allowDenyList.allowSlackChannel(opts.slack_channel_id, channelInfo?.channel.name) !== DenyReason.ALLOWED) {
            log.warn(`Channel ${opts.slack_channel_id} is not allowed to be bridged`);
            throw Error("The bridge config denies bridging this channel");
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
            if (channelInfo) {
                room.updateUsingChannelInfo(channelInfo);
                room.SlackChannelName = channelInfo.channel.name;
            }
            isNew = true;
            await this.stateStorage?.trackRoom(matrixRoomId);
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

        if (slackClient) {
            // PSA: Bots cannot join channels, they have a limited set of APIs https://api.slack.com/methods/bots.info
            room.setBotClient(slackClient);
        }

        if (isNew) {
            await this.addBridgedRoom(room);
        }
        if (room.isDirty) {
            await this.datastore.upsertRoom(room);
        }

        if (this.slackRtm && !room.SlackWebhookUri && room.SlackTeamId) {
            await this.slackRtm.startTeamClientIfNotStarted(room.SlackTeamId);
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
    }): Promise<void> {
        log.warn(`Trying to unlink ${opts.matrix_room_id}`);
        const room = this.rooms.getByMatrixRoomId(opts.matrix_room_id);
        if (!room) {
            throw Error("Cannot unlink - unknown channel");
        }

        this.rooms.removeRoom(room);
        this.stateStorage?.untrackRoom(opts.matrix_room_id);

        const id = room.toEntry().id;
        await this.drainAndLeaveMatrixRoom(opts.matrix_room_id);
        await this.datastore.deleteRoom(id);
    }

    public async checkLinkPermission(matrixRoomId: string, userId: string): Promise<boolean> {
        const USERS_DEFAULT = 0;
        const STATE_DEFAULT = 50;
        // We decide to allow a user to link or unlink, if they have a powerlevel
        //   sufficient to affect the 'm.room.power_levels' state; i.e. the
        //   "operator" heuristic.
        const powerLevels = await this.getState(matrixRoomId, "m.room.power_levels") as PowerLevelContent;
        let userLevel = (powerLevels?.users?.[userId] ?? powerLevels?.users_default ?? USERS_DEFAULT) as number;
        let requiresLevel = (powerLevels?.events?.["m.room.power_levels"] ?? powerLevels?.state_default ?? STATE_DEFAULT) as number;

        // Guard against non-number values in PLs
        if (typeof userLevel !== "number") {
            userLevel = USERS_DEFAULT;
        }
        if (typeof requiresLevel !== "number") {
            requiresLevel = STATE_DEFAULT;
        }

        return userLevel >= requiresLevel;
    }

    public async setUserAccessToken(userId: string, teamId: string, slackId: string, accessToken: string, puppeting: boolean,
        botAccessToken?: string): Promise<void> {
        const existingTeam = await this.datastore.getTeam(teamId);
        await this.datastore.insertAccount(userId, slackId, teamId, accessToken);
        if (puppeting) {
            // Store it here too for puppeting.
            await this.datastore.setPuppetToken(teamId, slackId, userId, accessToken);
            if (this.slackRtm) {
                await this.slackRtm.startUserClient({
                    teamId,
                    slackId,
                    matrixId: userId,
                    token: accessToken,
                });
            } else {
                log.warn(`RTM not configured, not starting client for ${userId} (${slackId})`);
            }
        }
        log.info(`Set new access token for ${userId} (team: ${teamId}, puppeting: ${puppeting})`);
        if (botAccessToken) {
            // Rather than upsert the values we were given, use the
            // access token to validate and make additional requests
            await this.clientFactory.upsertTeamByToken(
                botAccessToken,
            );
        }
        if (!existingTeam && !puppeting && this.teamSyncer) {
            log.info("This is a new team, so syncing members and channels");
            const team = await this.datastore.getTeam(teamId);
            const teamClient = await this.clientFactory.getTeamClient(teamId);
            if (!team) {
                throw Error("Team does not exist AFTER upserting. This should't happen");
            }
            try {
                await this.teamSyncer.syncUsers(
                    team,
                    teamClient,
                );
            } catch (ex) {
                log.warn("Failed to sync members", ex);
            }

            try {
                await this.teamSyncer.syncChannels(
                    teamId,
                    teamClient,
                );
            } catch (ex) {
                log.warn("Failed to sync channels", ex);
            }
        }
    }

    public async matrixUserInSlackTeam(teamId: string, userId: string): Promise<SlackAccount|undefined> {
        return (await this.datastore.getAccountsForMatrixUser(userId)).find((a) => a.teamId === teamId);
    }

    public async willExceedTeamLimit(teamId: string): Promise<boolean> {
        // First, check if we are limited
        if (!this.config.provisioning?.limits?.team_count) {
            return false;
        }
        const idSet = new Set((await this.datastore.getAllTeams()).map((t) => t.id));
        return idSet.add(teamId).size > this.config.provisioning?.limits?.team_count;
    }

    public async logoutAccount(userId: string, slackId: string): Promise<{deleted: boolean, msg?: string}> {
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
                return {
                    deleted: false,
                    msg: "You are the only user connected to Slack. You must unlink your rooms before you can unlink your account"
                };
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

        // Ensure we disconnect the account too
        await this.slackRtm?.disconnectClient(userId, slackId);
        await this.datastore.deleteAccount(userId, slackId);
        log.info(`Removed account ${slackId} from ${slackId}`);
        return { deleted: true };
    }

    public async getClientForPrivateChannel(teamId: string, roomId: string): Promise<WebClient|null> {
        // This only works for private rooms
        const bot = this.bridge.getBot();
        const members = Object.keys(await bot.getJoinedMembers(roomId));

        for (const matrixId of members) {
            const client = await this.clientFactory.getClientForUser(teamId, matrixId);
            if (client) {
                return client;
            }
        }
        return null;
    }

    public async killBridge(): Promise<void> {
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

    public get encryptRoom() {
        return this.config.encryption?.enabled;
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

    private async onMatrixPresence(ev: PresenceEvent) {
        log.debug(`Presence for ${ev.sender}`, ev);
        const presence = ev.content.presence === "online" ? "auto" : "away";
        const clients = await this.clientFactory.getClientsForUser(ev.sender);
        for (const client of clients) {
            log.debug(`Set presece of user on Slack to ${presence}`);
            await client.users.setPresence({
                presence,
            });
            // TODO: We need to bridge the status_msg somehow, but nothing in Slack
            // really fits.
        }
    }
    private onReadyProbe(_, res: Response) {
        res.status(this.ready ? 201 : 425).send("");
    }

    private async onUserActivityChanged(state: UserActivityState) {
        for (const userId of state.changed) {
            const activity = state.dataSet.get(userId);
            if (activity) {
                await this.datastore.storeUserActivity(userId, activity);
            }
        }
        await this.bridgeBlocker?.checkLimits(state.activeUsers);
    }

    private async pingBridge() {
        let internalRoom: string|null;
        try {
            internalRoom = await this.datastore.getUserAdminRoom("-internal-");
            if (!internalRoom) {
                internalRoom = (await this.bridge.getIntent().createRoom({ options: {}})).room_id;
                await this.datastore.setUserAdminRoom("-internal-", internalRoom);
            }
            const time = await this.bridge.pingAppserviceRoute(internalRoom);
            log.info(`Successfully pinged the bridge. Round trip took ${time}ms`);
        }
        catch (ex) {
            log.error("Homeserver cannot reach the bridge. You probably need to adjust your configuration.", ex);
        }
    }

    async disableHookHandler() {
        if (this.slackHookHandler) {
            await this.slackHookHandler.close();
            this.slackHookHandler = undefined;
            log.info("Disabled hook handler");
        }
    }

    public enableHookHandler() {
        this.slackHookHandler = new SlackHookHandler(this);
        log.info("Enabled hook handler");
    }

    async disableRtm() {
        if (this.slackRtm) {
            await this.slackRtm.disconnectAll();
            this.slackRtm = undefined;
            log.info("Disabled RTM");
        }
    }

    public enableRtm() {
        this.slackRtm = new SlackRTMHandler(this);
        log.info("Enabled RTM");
    }

}
