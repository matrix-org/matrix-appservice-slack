import { RTMClient, LogLevel } from "@slack/rtm-api";
import { Main, ISlackTeam } from "./Main";
import { SlackEventHandler } from "./SlackEventHandler";
import { Logging } from "matrix-appservice-bridge";
import { PuppetEntry } from "./datastore/Models";
import { ConversationsInfoResponse, ConversationsMembersResponse, ConversationsInfo } from "./SlackResponses";
import { ISlackMessageEvent } from "./BaseSlackHandler";
import { WebClient, Logger } from "@slack/web-api";
import { BridgedRoom } from "./BridgedRoom";
import { SlackGhost } from "./SlackGhost";
import { DMRoom } from "./rooms/DMRoom";

const log = Logging.get("SlackRTMHandler");

const LOG_TEAM_LEN = 12;
/**
 * This handler connects to Slack using the RTM API (events API, but websockets).
 * It reuses the SlackEventHandler to handle events.
 */
export class SlackRTMHandler extends SlackEventHandler {
    private rtmTeamClients: Map<string, Promise<RTMClient>>; // team -> client
    private rtmUserClients: Map<string, RTMClient>; // team:mxid -> client
    private messageQueueBySlackId: Map<string, Promise<void>>; // teamid+channelid -> promise
    constructor(main: Main) {
        super(main);
        this.rtmTeamClients = new Map();
        this.rtmUserClients = new Map();
        this.messageQueueBySlackId = new Map();
    }

    public async getUserClient(teamId: string, matrixId: string): Promise<RTMClient|undefined> {
        const key = `${teamId}:${matrixId}`;
        return this.rtmUserClients.get(key);
    }

    public async startUserClient(puppetEntry: PuppetEntry) {
        const key = `${puppetEntry.teamId}:${puppetEntry.matrixId}`;
        if (this.rtmUserClients.has(key)) {
            log.debug(`${key} is already connected`);
            return;
        }
        log.debug(`Starting RTM client for user ${key}`);
        const rtm = this.createRtmClient(puppetEntry.token, puppetEntry.matrixId);
        const slackClient = await this.main.clientFactory.getClientForUser(puppetEntry.teamId, puppetEntry.matrixId);
        if (!slackClient) {
            return; // We need to be able to determine what a channel looks like.
        }
        let teamInfo: ISlackTeam;
        rtm.on("message", async (e) => {
            log.debug(`Got message for ${puppetEntry.matrixId} to ${e.channel}`);
            const messageQueueKey = `${puppetEntry.teamId}:${e.channel}`;
            // This is used to ensure that we do not race messages for a single channel.
            if (this.messageQueueBySlackId.has(messageQueueKey)) {
                await this.messageQueueBySlackId.get(messageQueueKey);
            }
            const messagePromise = this.handleRtmMessage(puppetEntry, slackClient, teamInfo, e);
            this.messageQueueBySlackId.set(messageQueueKey, messagePromise);
            await messagePromise;
        });
        // rtm.on("im_marked", async (event) => {
        //     const room = this.main.rooms.getBySlackChannelId(event.channel);
        //     const info = (await slackClient.conversations.info({channel: event.channel})) as ConversationsInfoResponse;
        //     if (room) {
        //         room.updateSlackReadMaker(event.ts, info.channel.user!);
        //     }
        // });
        this.rtmUserClients.set(key, rtm);
        const { team } = await rtm.start();
        teamInfo = team as ISlackTeam;

        log.debug(`Started RTM client for user ${key}`, team);
    }

    // tslint:disable-next-line: no-any
    private async handleRtmMessage(puppetEntry: PuppetEntry, slackClient: WebClient, teamInfo: ISlackTeam, e: any) {
        log.debug(`handleRtmMessage ${puppetEntry.matrixId} ${teamInfo.id}`);
        const chanInfo = (await slackClient!.conversations.info({channel: e.channel})) as ConversationsInfoResponse;
        // is_private is unreliably set.
        chanInfo.channel.is_private = chanInfo.channel.is_im || chanInfo.channel.is_group;
        if (chanInfo.channel.is_channel || !chanInfo.channel.is_private) {
            // Never forward messages on from the users workspace if it's public
        }
        // Sneaky hack to set the domain on messages.
        e.team_id = teamInfo.id;
        e.team_domain = teamInfo.domain;
        e.user_id = e.user;

        return this.handleUserMessage(chanInfo, e, slackClient, puppetEntry);
    }

    public teamIsUsingRtm(teamId: string): boolean {
        return this.rtmTeamClients.has(teamId.toUpperCase());
    }

    public async teamCanUseRTM(team: string): Promise<boolean> {
        const teamEntry = (await this.main.datastore.getTeam(team));
        if (!teamEntry) {
            return false;
        }
        if (!teamEntry.bot_token.startsWith("xoxb")) {
            return false; // User tokens are not able to use the RTM API
        }
        return true; // Bots can use RTM by default, yay \o/.
    }

    public async startTeamClientIfNotStarted(expectedTeam: string) {
        if (this.rtmTeamClients.has(expectedTeam)) {
            log.debug(`${expectedTeam} is already connected`);
            try {
                await this.rtmTeamClients.get(expectedTeam);
                return;
            } catch (ex) {
                log.warn("Failed to create RTM client");
            }
        }
        if (!(await this.teamCanUseRTM(expectedTeam))) {
            // Cannot use RTM, no-op.
            return;
        }
        const team = (await this.main.datastore.getTeam(expectedTeam))!;
        const promise = this.startTeamClient(expectedTeam, team.bot_token);
        this.rtmTeamClients.set(expectedTeam.toUpperCase(), promise);
        await promise;
    }

    private async startTeamClient(expectedTeam: string, botToken: string) {
        if (!botToken.startsWith("xoxb")) {
            throw Error("Bot token invalid, must start with xoxb");
        }
        const rtm = this.createRtmClient(botToken, expectedTeam);

        // For each event that SlackEventHandler supports, register
        // a listener.
        SlackEventHandler.SUPPORTED_EVENTS.forEach((eventName) => {
            rtm.on(eventName, async (event) => {
                try {
                    if (!rtm.activeTeamId) {
                        log.error("Cannot handle event, no active teamId!");
                        return;
                    }
                    await this.handle(event, rtm.activeTeamId! , () => {}, false);
                } catch (ex) {
                    log.error(`Failed to handle '${eventName}' event`);
                }
            });
        });

        try {
            const { team } = await rtm.start();
            const teamInfo = team as ISlackTeam;
            log.info("Connected RTM client for ", teamInfo);
        } catch (ex) {
            log.error("Failed to connect RTM client for ", expectedTeam);
            throw ex;
        }
        return rtm;
    }

    private createRtmClient(token: string, logLabel: string): RTMClient {
        const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"];
        const connLog = Logging.get(`RTM-${logLabel.substr(0, LOG_TEAM_LEN)}`);
        const logLevel = LOG_LEVELS.indexOf(this.main.config.rtm!.log_level || "silent");
        const rtm = new RTMClient(token, {
            logLevel: LogLevel.DEBUG, // We will filter this ourselves.
            logger: {
                getLevel: () => LogLevel.DEBUG,
                setLevel: () => {},
                setName: () => {}, // We handle both of these ourselves.
                debug: logLevel <= 0 ? connLog.debug.bind(connLog) : () => {},
                warn: logLevel <= 1 ? connLog.warn.bind(connLog) : () => {},
                info: logLevel <= 2 ? connLog.info.bind(connLog) : () => {},
                error: logLevel <= 3 ? connLog.error.bind(connLog) : () => {},
            } as Logger,
        });

        rtm.on("error", (error) => {
            // We must handle this lest the process be killed.
            connLog.error("Encountered 'error' event:", error);
        });
        return rtm;
    }

    private async handleUserMessage(chanInfo: ConversationsInfoResponse, event: ISlackMessageEvent, slackClient: WebClient, puppet: PuppetEntry) {
        log.debug("Received slack user event:", puppet.matrixId, event);
        if (event.subtype === "group_join" && event.user === puppet.slackId) {
            if (this.main.teamSyncer) {
                await this.main.teamSyncer.onDiscoveredPrivateChannel(puppet.teamId, slackClient, chanInfo);
            }
            // This could be a new private room, check in on it.
        } // We also want to join the room down here.
        let room = this.main.rooms.getBySlackChannelId(event.channel) as BridgedRoom;
        if (room) {
            return this.handleMessageEvent(event, puppet.teamId);
        }
        const channelMembersRes = (await slackClient.conversations.members({ channel: chanInfo.channel.id })) as ConversationsMembersResponse;
        const ghosts = await Promise.all(channelMembersRes.members.map(
            // tslint:disable-next-line: no-any
            (id) => this.main.getGhostForSlack(id, (event as any).team_domain, puppet.teamId)),
        );
        const ghost = await this.main.getGhostForSlackMessage(event, puppet.teamId);
        if (chanInfo.channel.is_im || chanInfo.channel.is_mpim) {
            log.info(`Creating new DM room for ${event.channel}`);
            const otherGhosts = ghosts.filter((g) => g.slackId !== puppet.slackId)!;
            const name = await this.determineRoomName(chanInfo.channel, otherGhosts, puppet, slackClient);
            // Create a new DM room.
            const { room_id } = await ghost.intent.createRoom({
                createAsClient: true,
                options: {
                    invite: [puppet.matrixId].concat(ghosts.map((g) => g.userId!)),
                    preset: "private_chat",
                    is_direct: true,
                    name,
                },
            });
            const team = (await this.main.datastore.getTeam(puppet.teamId))!;
            room = new DMRoom(this.main, {
                inbound_id: chanInfo.channel.id,
                matrix_room_id: room_id,
                slack_team_id: puppet.teamId,
                slack_channel_id: chanInfo.channel.id,
                slack_channel_name: chanInfo.channel.name,
                puppet_owner: puppet.matrixId,
                is_private: chanInfo.channel.is_private,
            }, team, slackClient);
            room.updateUsingChannelInfo(chanInfo);
            await this.main.addBridgedRoom(room);
            await this.main.datastore.upsertRoom(room);
            await Promise.all(otherGhosts.map((g) => g.intent.join(room_id)));
            return this.handleMessageEvent(event, puppet.teamId);
        }
        log.warn(`No room found for ${event.channel} and not sure how to create one`);
        return;
    }

    private async determineRoomName(chan: ConversationsInfo, otherGhosts: SlackGhost[],
                                    puppet: PuppetEntry, client: WebClient): Promise<string|undefined> {
        if (chan.is_mpim) {
            return undefined; // allow the client to decide.
        }
        if (otherGhosts.length) {
            return await otherGhosts[0].getDisplayname(client);
        }
        // No other ghosts, leave it undefined.
    }
}
