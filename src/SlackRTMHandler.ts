import { RTMClient, LogLevel, RTMClientOptions } from "@slack/rtm-api";
import { Main, ISlackTeam } from "./Main";
import { SlackEventHandler } from "./SlackEventHandler";
import { Logger } from "matrix-appservice-bridge";
import { PuppetEntry } from "./datastore/Models";
import { ConversationsInfoResponse, ConversationsMembersResponse, ConversationsInfo, UsersInfoResponse } from "./SlackResponses";
import { ISlackMessageEvent } from "./BaseSlackHandler";
import { WebClient, Logger as SlackLogger } from "@slack/web-api";
import { BridgedRoom } from "./BridgedRoom";
import { SlackGhost } from "./SlackGhost";
import { DenyReason } from "./AllowDenyList";
import { createDM } from "./RoomCreation";
import { HttpsProxyAgent } from 'https-proxy-agent';

const log = new Logger("SlackRTMHandler");

const LOG_TEAM_LEN = 12;
/**
 * This handler connects to Slack using the Real Time Messaging (RTM) API.
 * It reuses the SlackEventHandler to handle events.
 * The RTM API works like the Events API, but uses websockets. https://api.slack.com/rtm
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

    public async startUserClient(puppetEntry: PuppetEntry): Promise<void> {
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
        rtm.on("message", (messageEvent) => {
            const messageQueueKey = `${puppetEntry.teamId}:${messageEvent.channel}`;
            const  chainPromise: Promise<void> = this.messageQueueBySlackId.get(messageQueueKey) || Promise.resolve();
            // This is used to ensure that we do not race messages for a single channel.
            const messagePromise = chainPromise.then(
                async () => this.handleRtmMessage(puppetEntry, slackClient, teamInfo, messageEvent).catch((ex) => {
                    log.error(`Error handling 'message' event for ${puppetEntry.matrixId} / ${puppetEntry.slackId}`, ex);
                })
            );
            this.messageQueueBySlackId.set(messageQueueKey, messagePromise);
        });
        this.rtmUserClients.set(key, rtm);
        const { team } = await rtm.start();
        const teamInfo = team as ISlackTeam;

        log.debug(`Started RTM client for user ${key}`, team);
    }

    private async handleRtmMessage(puppetEntry: PuppetEntry, slackClient: WebClient, teamInfo: ISlackTeam, messageEvent: ISlackMessageEvent) {
        const chanInfo = (await slackClient.conversations.info({channel: messageEvent.channel})) as ConversationsInfoResponse;
        // is_private is unreliably set.
        chanInfo.channel.is_private = chanInfo.channel.is_private || chanInfo.channel.is_im || chanInfo.channel.is_group;
        if (!chanInfo.channel.is_private) {
            // Never forward messages on from the users workspace if it's public
            return;
        }
        // Sneaky hack to set the domain on messages.
        messageEvent.team_id = teamInfo.id;
        if (!messageEvent.team_id) {
            messageEvent.team_id = teamInfo.id;
        }
        if (!messageEvent.team_domain) {
            messageEvent.team_domain = teamInfo.domain;
        }
        if (messageEvent.user && !messageEvent.user_id) {
            messageEvent.user_id = messageEvent.user;
        }

        return this.handleUserMessage(chanInfo, messageEvent, slackClient, puppetEntry);
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

    public async disconnectClient(teamId: string, userId: string) {
        const key = `${teamId}:${userId}`;
        const client = this.rtmUserClients.get(`${teamId}:${userId}`);
        if (!client) {
            return;
        }
        await client.disconnect();
        this.rtmUserClients.delete(key);
    }

    public async disconnectAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const kv of this.rtmTeamClients.entries()) {
            promises.push((async () => {
                try {
                    const client = (await kv[1]);
                    await client.disconnect();
                } catch (ex) {
                    log.warn(`Failed to disconnect team client for ${kv[0]} gracefully`);
                }
            })());
        }

        for (const kv of this.rtmUserClients.entries()) {
            promises.push((async () => {
                try {
                    await kv[1].disconnect();
                } catch (ex) {
                    log.warn(`Failed to disconnect user client for ${kv[0]} gracefully`);
                }
            })());
        }

        this.rtmUserClients.clear();
        this.rtmTeamClients.clear();
        await Promise.all(promises);
    }

    public async startTeamClientIfNotStarted(expectedTeam: string): Promise<void> {
        const team = (await this.main.datastore.getTeam(expectedTeam));
        if (!team) {
            log.warn("startTeamClientIfNotStarted: could not find team");
            return;
        }
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
            rtm.on(eventName, (event) => {
                if (!rtm.activeTeamId) {
                    log.error(`Cannot handle event, no active teamId! (for expected team ${expectedTeam})`);
                    return;
                }
                this.handle(event, rtm.activeTeamId , () => {}, false).catch((ex) => {
                    log.error(`Failed to handle '${eventName}' event for ${rtm.activeTeamId}`, ex);
                });
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
        const connLog = new Logger(`RTM-${logLabel.slice(0, LOG_TEAM_LEN)}`);
        const logLevel = LOG_LEVELS.indexOf(this.main.config.rtm?.log_level || "silent");
        const rtmOpts = {
            logLevel: LogLevel.DEBUG, // We will filter this ourselves.
            logger: {
                getLevel: () => LogLevel.DEBUG,
                setLevel: () => {},
                setName: () => {}, // We handle both of these ourselves.
                debug: logLevel <= 0 ? connLog.debug.bind(connLog) : () => {},
                warn: logLevel <= 1 ? connLog.warn.bind(connLog) : () => {},
                info: logLevel <= 2 ? connLog.info.bind(connLog) : () => {},
                error: logLevel <= 3 ? connLog.error.bind(connLog) : () => {},
            } as SlackLogger,
        } as RTMClientOptions;

        if (this.main.config.slack_proxy) {
            rtmOpts.agent = new HttpsProxyAgent(this.main.config.slack_proxy);
        }

        const rtm = new RTMClient(token, rtmOpts);

        rtm.on("error", (error) => {
            // We must handle this lest the process be killed.
            connLog.error("Encountered 'error' event:", error);
        });
        return rtm;
    }

    private async handleUserMessage(chanInfo: ConversationsInfoResponse, event: ISlackMessageEvent, slackClient: WebClient, puppet: PuppetEntry) {
        log.debug("Received Slack user event:", puppet.matrixId, event);
        let room = this.main.rooms.getBySlackChannelId(event.channel) as BridgedRoom;
        const isIm = chanInfo.channel.is_im || chanInfo.channel.is_mpim;
        if (room) {
            if (event.type === 'message' && room.IsPrivate) {
                const intent = await room.getIntentForRoom();
                // We only want to act on trivial messages
                // This can be asyncronous to the handling of the message.
                intent.getStateEvent(room.MatrixRoomId, 'm.room.member', puppet.matrixId, true).then(async (state) => {
                    if (!['invite', 'join'].includes(state?.membership)) {
                        // Automatically invite the user the room.
                        log.info(`User ${puppet.matrixId} is not in ${room.MatrixRoomId}/${room.SlackChannelId}, inviting`);
                        return intent.invite(room.MatrixRoomId, puppet.matrixId);
                    }
                }).catch((ex) => {
                    log.error(`Failed to automatically invite ${puppet.matrixId} to ${room.MatrixRoomId}`, ex);
                });
            }
            return this.handleEvent(event, puppet.teamId);
        }

        if (!event.user) {
            log.debug("No `user` field on event, not creating a new room");
            return;
        }


        if (chanInfo.channel.is_im && chanInfo.channel.user) {
            const userData = (await slackClient.users.info({
                user: chanInfo.channel.user,
            })) as UsersInfoResponse;
            // Check if the user is denied Slack Direct Messages (DMs)
            const denyReason = this.main.allowDenyList.allowDM(puppet.matrixId, chanInfo.channel.user, userData.user?.name);
            if (denyReason !== DenyReason.ALLOWED) {
                log.warn(
                    `Slack user '${chanInfo.channel.user}' is disallowed from DMing, not creating room. ` +
                    `(Denied due to ${DenyReason[denyReason]} user)`
                );
                return;
            }
        }

        const team = (await this.main.datastore.getTeam(puppet.teamId));
        if (!team) {
            throw Error("Could not find team in datastore, cannot handle RTM event!");
        }

        if (isIm) {
            const channelMembersRes = (await slackClient.conversations.members({ channel: chanInfo.channel.id })) as ConversationsMembersResponse;
            const ghosts = (await Promise.all(channelMembersRes.members.map(
                async (id) =>
                    id ? this.main.ghostStore.get(id, event.team_domain, puppet.teamId) : null,
            ))).filter((g) => g !== null) as SlackGhost[];

            const puppetedGhost = ghosts.find(g => g.slackId === puppet.slackId);
            const otherGhosts = ghosts.filter(g => g !== puppetedGhost);
            const ghost = !otherGhosts.length ? puppetedGhost : otherGhosts[0];
            if (!ghost) {
                log.warn(`Could not find Slack receipient of IM ${chanInfo.channel}`);
                return;
            }
            if (otherGhosts.length > 1) {
                log.warn(`Expected only 1 other ghost in a Slack IM, but found ${otherGhosts.length}`);
            }

            log.info(`Creating new DM room for ${event.channel}`);
            // Create a new DM room.
            await ghost.update({ user: ghost.slackId });
            const roomId = await createDM(
                ghost.intent,
                [puppet.matrixId].concat(ghosts.map((g) => g.matrixUserId)),
                await this.determineRoomMetadata(chanInfo.channel, ghost),
                this.main.encryptRoom,
            );
            room = new BridgedRoom(this.main, {
                inbound_id: chanInfo.channel.id,
                matrix_room_id: roomId,
                slack_team_id: puppet.teamId,
                slack_channel_id: chanInfo.channel.id,
                slack_channel_name: chanInfo.channel.name,
                puppet_owner: puppet.matrixId,
                is_private: chanInfo.channel.is_private,
                slack_type: chanInfo.channel.is_im ? "im" : "mpim",
            }, team, slackClient);
            room.updateUsingChannelInfo(chanInfo);
            await this.main.addBridgedRoom(room);
            await this.main.datastore.upsertRoom(room);
            room.waitForJoin();

            await Promise.all(otherGhosts.map(async(g) => g.intent.join(roomId)));
            return this.handleEvent(event, puppet.teamId);
        } else if (this.main.teamSyncer) {
            // A private channel may not have is_group set if it's an older channel.
            try {
                await this.main.teamSyncer.onDiscoveredPrivateChannel(puppet.teamId, slackClient, chanInfo);
            } catch (ex) {
                log.warn(`Could not create room for ${event.channel}: ${ex}`);
            }
            return this.handleEvent(event, puppet.teamId);
        }
        log.warn(`No room found for ${event.channel} and not sure how to create one`);
        log.info("Failing channel info:", chanInfo.channel);
    }

    private async determineRoomMetadata(chan: ConversationsInfo, ghost: SlackGhost) {
        if (chan.is_mpim) {
            return undefined; // allow the client to decide.
        }
        return await ghost.intent.getProfileInfo(ghost.matrixUserId);
    }
}
