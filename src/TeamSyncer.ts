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

import { Logging } from "matrix-appservice-bridge";
import { BridgedRoom } from "./BridgedRoom";
import { Main } from "./Main";
import { ConversationsInfoResponse, UsersInfoResponse, ConversationsListResponse, ConversationsInfo,
    UsersListResponse, ConversationsMembersResponse } from "./SlackResponses";
import { WebClient } from "@slack/web-api";
import PQueue from "p-queue";
import { ISlackUser } from "./BaseSlackHandler";
import { DenyReason } from "./AllowDenyList";
import { TeamEntry } from "./datastore/Models";
import { SlackGhost } from "./SlackGhost";

const log = Logging.get("TeamSyncer");

export interface ITeamSyncConfig {
    channels?: {
        enabled: boolean;
        whitelist?: string[];
        blacklist?: string[];
        alias_prefix?: string;
        allow_private?: boolean;
        allow_public?: boolean;
    };
    users?: {
        enabled: boolean;
    };
}

const TEAM_SYNC_CONCURRENCY = 1;
const TEAM_SYNC_ITEM_CONCURRENCY = 5;
const JOIN_CONCURRENCY = 5;
const TEAM_SYNC_MIN_WAIT = 5000;
const TEAM_SYNC_MAX_WAIT = 15000;
const TEAM_SYNC_FAILSAFE = 10;

/**
 * This class handles syncing slack teams to Matrix.
 */
export class TeamSyncer {
    private teamConfigs: {[teamId: string]: ITeamSyncConfig} = {};
    constructor(private main: Main) {
        const config = main.config;
        if (!config.team_sync) {
            throw Error("team_sync is not defined in the config");
        }
        // Apply defaults to configs
        this.teamConfigs = config.team_sync;
        for (const teamConfig of Object.values(this.teamConfigs)) {
            if (teamConfig.channels?.enabled) {
                // Allow public by default
                teamConfig.channels.allow_public = teamConfig.channels.allow_public === undefined ? true : teamConfig.channels.allow_public;
                // Allow private by default
                teamConfig.channels.allow_private = teamConfig.channels.allow_private === undefined ? true : teamConfig.channels.allow_private;
                if (!teamConfig.channels.allow_public && !teamConfig.channels.allow_private) {
                    throw Error('At least one of allow_public, allow_private must be true in the teamSync config');
                }
            }
        }
    }

    public async syncAllTeams(teamClients: { [id: string]: WebClient; }): Promise<void> {
        const queue = new PQueue({concurrency: TEAM_SYNC_CONCURRENCY});
        const functionsForQueue: (() => Promise<void>)[] = [];
        for (const [teamId, client] of Object.entries(teamClients)) {
            if (!this.getTeamSyncConfig(teamId)) {
                log.info(`Not syncing ${teamId}, team is not configured to sync`);
                continue;
            }
            const team = await this.main.datastore.getTeam(teamId);
            if (!team || !team.domain) {
                log.info(`Not syncing ${teamId}, no team configured in store`);
                continue;
            }
            functionsForQueue.push(async () => this.syncUsers(team, client));
            functionsForQueue.push(async () => this.syncChannels(teamId, client));
        }
        try {
            log.info("Waiting for all teams to sync");
            // .addAll waits for all promises to resolve.
            await queue.addAll(functionsForQueue);
            log.info("All teams have synced");
        } catch (ex) {
            log.error("There was an issue when trying to sync teams:", ex);
        }
    }

    public async syncUsers(team: TeamEntry, client: WebClient): Promise<void> {
        const teamConfig = this.getTeamSyncConfig(team.id, "user");
        if (!teamConfig) {
            log.warn(`Not syncing userss for ${team.id}`);
            return;
        }
        const itemList: ISlackUser[] = [];
        let cursor: string|undefined;
        for (let i = 0; i < TEAM_SYNC_FAILSAFE && (cursor === undefined || cursor !== ""); i++) {
            const res = (await client.users.list({
                limit: 1000,
                cursor,
            })) as UsersListResponse;
            itemList.push(...res.members);

            cursor = res.response_metadata.next_cursor;
            if (cursor !== "") {
                // Get an evenly distributed number >= TEAM_SYNC_MIN_WAIT and < TEAM_SYNC_MAX_WAIT.
                const ms = Math.random() * (TEAM_SYNC_MAX_WAIT - TEAM_SYNC_MIN_WAIT) + TEAM_SYNC_MIN_WAIT;
                log.debug(`Waiting ${ms}ms before returning more rows`);
                await new Promise((r) => setTimeout(
                    r,
                    ms,
                ));
            }
        }
        log.info(`Found ${itemList.length} total users`);
        const queue = new PQueue({ concurrency: TEAM_SYNC_ITEM_CONCURRENCY });
        // .addAll waits for all promises to resolve.
        await queue.addAll(itemList.map(item => this.syncUser.bind(this, team.id, team.domain, item)));
    }

    public async syncChannels(teamId: string, client: WebClient): Promise<void> {
        const teamConfig = this.getTeamSyncConfig(teamId, "channel");
        if (!teamConfig) {
            log.warn(`Not syncing channels for ${teamId}`);
            return;
        }
        const itemList: ConversationsInfo[] = [];
        let cursor: string|undefined;
        for (let i = 0; i < TEAM_SYNC_FAILSAFE && (cursor === undefined || cursor !== ""); i++) {
            const types: string[] = [];
            if (teamConfig.channels?.allow_private) {
                types.push("private_channel");
            }
            if (teamConfig.channels?.allow_public) {
                types.push("public_channel");
            }
            if (!types.length) {
                throw Error('No types specified');
            }
            const res = await client.conversations.list({
                limit: 1000,
                exclude_archived: true,
                types: types.join(","),
                cursor,
            }) as ConversationsListResponse;
            itemList.push(...res.channels);

            cursor = res.response_metadata.next_cursor;
            if (cursor !== "") {
                // Get an evenly distributed number >= TEAM_SYNC_MIN_WAIT and < TEAM_SYNC_MAX_WAIT.
                const ms = Math.random() * (TEAM_SYNC_MAX_WAIT - TEAM_SYNC_MIN_WAIT) + TEAM_SYNC_MIN_WAIT;
                log.info(`Waiting ${ms}ms before returning more rows`);
                await new Promise((r) => setTimeout(
                    r,
                    ms,
                ));
            }
        }
        log.info(`Found ${itemList.length} total channels`);
        const queue = new PQueue({ concurrency: TEAM_SYNC_ITEM_CONCURRENCY });
        // .addAll waits for all promises to resolve.
        await queue.addAll(itemList.map(item => this.syncChannel.bind(this, teamId, item)));
    }

    private getTeamSyncConfig(teamId: string, item?: "channel"|"user", itemId?: string, isPrivate = false) {
        const teamConfig = this.teamConfigs[teamId] || this.teamConfigs.all;
        if (!teamConfig) {
            return false;
        }
        if (item === "channel") {
            if (!teamConfig.channels?.enabled) {
                return false;
            }
            if (isPrivate && !teamConfig.channels.allow_private) {
                return false;
            }
            if (!isPrivate && !teamConfig.channels.allow_public) {
                return false;
            }
        }
        if (item === "user" && (!teamConfig.users || !teamConfig.users.enabled)) {
            return false;
        }
        const channels = teamConfig.channels;
        if (item === "channel" && channels && itemId) {
            if (channels.blacklist) {
                if (channels.blacklist.includes(itemId)) {
                    log.warn("Not bridging channel, blacklisted");
                    return false;
                }
            }
            if (channels.whitelist) {
                if (!channels.whitelist.includes(itemId)) {
                    log.warn("Not bridging channel, not in whitelist");
                    return false;
                }
            }
        }
        return teamConfig;
    }

    public async onChannelAdded(teamId: string, channelId: string, name: string, creator: string): Promise<void> {
        log.info(`${teamId} ${creator} created channel ${channelId} ${name}`);
        const client = await this.main.clientFactory.getTeamClient(teamId);
        const { channel } = (await client.conversations.info({ channel: channelId })) as ConversationsInfoResponse;
        await this.syncChannel(teamId, channel);
    }

    public async onDiscoveredPrivateChannel(teamId: string, client: WebClient, chanInfo: ConversationsInfoResponse): Promise<void> {
        log.info(`Discovered private channel ${teamId} ${chanInfo.channel.id}`);
        const channelItem = chanInfo.channel;
        if (!this.getTeamSyncConfig(teamId, "channel", channelItem.id, true)) {
            throw Error(`Not syncing due to team sync config`);
        }
        if (this.main.allowDenyList.allowSlackChannel(channelItem.id, channelItem.name) !== DenyReason.ALLOWED) {
            throw Error(`Not syncing due to ADL list`);
        }
        const existingChannel = this.main.rooms.getBySlackChannelId(channelItem.id);
        if (existingChannel) {
            log.debug("Channel already exists in datastore, not bridging");
            return;
        }
        if (channelItem.is_im || channelItem.is_mpim || !channelItem.is_private) {
            throw Error(`Not creating channel: Is not a private channel`);
        }
        const team = await this.main.datastore.getTeam(teamId);
        if (!team) {
            throw Error(`team could not be found for channel`);
        }
        log.info(`Attempting to dynamically bridge private ${channelItem.id} ${channelItem.name}`);
        // Create the room first.
        try {
            const members = await this.mapChannelMembershipToMatrixIds(teamId, client, channelItem.id);
            const roomId = await this.createRoomForChannel(teamId, channelItem.creator, channelItem, false, members);
            const inboundId = this.main.genInboundId();
            const room = new BridgedRoom(this.main, {
                inbound_id: inboundId,
                matrix_room_id: roomId,
                slack_team_id: teamId,
                slack_channel_id: channelItem.id,
                is_private: true,
                slack_type: "channel",
            }, team, client);
            room.updateUsingChannelInfo(chanInfo);
            this.main.rooms.upsertRoom(room);
            await this.main.datastore.upsertRoom(room);
        } catch (ex) {
            log.error("Failed to provision new room dynamically:", ex);
        }
    }

    public async syncUser(teamId: string, domain: string, item: ISlackUser): Promise<void> {
        log.info(`Syncing user ${teamId} ${item.id}`);
        const existingGhost = await this.main.ghostStore.getExisting(this.main.ghostStore.getUserId(item.id, domain));
        if (item.deleted && !existingGhost) {
            // This is a deleted user that we've never seen, bail.
            return;
        }
        const slackGhost = existingGhost || await this.main.ghostStore.get(item.id, domain, teamId);
        if (item.deleted !== true) {
            await slackGhost.updateFromISlackUser(item);
            return;
        }
        log.warn(`User ${item.id} has been deleted`);
        await slackGhost.intent.setDisplayName("Deleted User");
        // As of 2020-07-28 the spec does not specify how to reset avatars.
        // Element does it by sending an empty string.
        // https://github.com/matrix-org/matrix-doc/issues/1674
        await slackGhost.intent.setAvatarUrl("");
        // XXX: We *should* fetch the rooms the user is actually in rather
        // than just removing it from every room. However, this is quicker to
        // implement.
        log.info("Leaving from all rooms");
        const teamRooms = this.main.rooms.getBySlackTeamId(teamId);
        let i = teamRooms.length;
        await Promise.all(teamRooms.map(async(r) =>
            slackGhost.intent.leave(r.MatrixRoomId).catch(() => {
                i--;
                // Failing to leave a room is fairly normal.
            }),
        ));
        log.info(`Left ${i} rooms`);
        return;
    }

    private async syncChannel(teamId: string, channelItem: ConversationsInfo) {
        const config = this.getTeamSyncConfig(teamId, "channel", channelItem.id, channelItem.is_private);
        log.info(`Syncing channel ${teamId} ${channelItem.name} (${channelItem.id})`);
        if (!config) {
            log.warn("Channel is not allowed to be bridged by the sync config");
            return;
        }
        if (this.main.allowDenyList.allowSlackChannel(channelItem.id, channelItem.name) !== DenyReason.ALLOWED) {
            log.warn("Channel is not allowed to be bridged by the allow / deny list");
            return;
        }

        const client = await this.main.clientFactory.getTeamClient(teamId);
        const existingChannel = this.main.rooms.getBySlackChannelId(channelItem.id);
        let roomId: string;
        if (!existingChannel) {
            if (!channelItem.is_channel && !(config.channels?.allow_private && channelItem.is_private)) {
                log.debug("Not creating room for channel: Is either private or not a channel");
                return;
            }

            try {
                roomId = await this.bridgeChannelToNewRoom(teamId, channelItem, client);
            } catch (ex) {
                log.error("Failed to provision new room dynamically:", ex);
                throw ex;
            }
        } else {
            log.debug("Not creating room for channel: Already exists");
            roomId = existingChannel.MatrixRoomId;
        }

        try {
            // Always sync membership for rooms.
            try {
                if (channelItem.is_private === false) {
                    await this.ensureBotInChannel(channelItem.id, teamId);
                }
            } catch (ex) {
                // This can happen if we don't have a puppet yet. Not to worry.
                log.warn(`Could not ensure bot is in channel ${channelItem.id}: ${ex.message}`);
            }
            await this.syncMembershipForRoom(roomId, channelItem.id, teamId, client);
        } catch (ex) {
            log.error("Failed to sync membership to room:", ex);
            return;
        }
    }

    public async onChannelDeleted(teamId: string, channelId: string): Promise<void> {
        log.info(`${teamId} removed channel ${channelId}`);
        if (!this.getTeamSyncConfig(teamId, "channel", channelId)) {
            return;
        }
        const room = this.main.rooms.getBySlackChannelId(channelId);
        if (!room) {
            log.warn("Not unlinking channel, no room found");
            return;
        }

        try {
            await this.main.botIntent.sendMessage(room.MatrixRoomId, {
                msgtype: "m.notice",
                body: "The Slack channel bridged to this room has been deleted.",
            });
        } catch (ex) {
            log.warn("Failed to send deletion notice into the room:", ex);
        }

        // Hide deleted channels in the room directory.
        try {
            await this.main.botIntent.getClient().setRoomDirectoryVisibility(room.MatrixRoomId, "private");
        } catch (ex) {
            log.warn("Failed to hide room from the room directory:", ex);
        }

        try {
            await this.main.actionUnlink({ matrix_room_id: room.MatrixRoomId });
        } catch (ex) {
            log.warn("Tried to unlink room but failed:", ex);
        }
    }

    public async syncMembershipForRoom(roomId: string, channelId: string, teamId: string, client: WebClient): Promise<void> {
        const existingGhosts = await this.main.listGhostUsers(roomId);
        // We assume that we have this
        const teamInfo = (await this.main.datastore.getTeam(teamId));
        if (!teamInfo) {
            throw Error("Could not find team");
        }
        // Finally, sync membership for the channel.
        const members = await client.conversations.members({channel: channelId}) as ConversationsMembersResponse;
        // Ghosts will exist already: We joined them in the user sync.
        const ghosts = await Promise.all(members.members.map(async(slackUserId) => this.main.ghostStore.get(slackUserId, teamInfo.domain, teamId)));

        const joinedUsers = ghosts.filter((g) => !existingGhosts.includes(g.userId)); // Skip users that are joined.
        const leftUsers = existingGhosts.map((userId) => ghosts.find((g) => g.userId === userId )).filter(g => !!g) as SlackGhost[];
        log.info(`Joining ${joinedUsers.length} ghosts to ${roomId}`);
        log.info(`Leaving ${leftUsers.length} ghosts to ${roomId}`);

        const queue = new PQueue({concurrency: JOIN_CONCURRENCY});

        // Join users who aren't joined
        void queue.addAll(joinedUsers.map((ghost) => async () => {
            try {
                await ghost.intent.join(roomId);
            } catch (ex) {
                log.warn(`Failed to join ${ghost.userId} to ${roomId}`);
            }
        }));

        // Leave users who are joined
        void queue.addAll(leftUsers.map((ghost) => async () => {
            try {
                await ghost.intent.leave(roomId);
            } catch (ex) {
                log.warn(`Failed to leave ${ghost.userId} from ${roomId}`);
            }
        }));

        await queue.onIdle();
        log.debug(`Finished syncing membership to ${roomId}`);
    }

    private getAliasPrefix(teamId: string) {
        const channelConfig = this.getTeamSyncConfig(teamId);
        if (channelConfig === false || channelConfig.channels === undefined) {
            return;
        }
        return channelConfig.channels.alias_prefix;
    }

    private async bridgeChannelToNewRoom(teamId: string, channelItem: ConversationsInfo, client: WebClient) {
        const teamInfo = (await this.main.datastore.getTeam(teamId));
        if (!teamInfo) {
            throw Error("Could not find team");
        }
        log.info(`Attempting to dynamically bridge ${channelItem.id} ${channelItem.name}`);
        if (this.main.allowDenyList.allowSlackChannel(channelItem.id, channelItem.name) !== DenyReason.ALLOWED) {
            log.warn("Channel is not allowed to be bridged");
        }

        const {user} = (await client.users.info({ user: teamInfo.user_id })) as UsersInfoResponse;
        if (!user) {
            throw Error("Could not find user info");
        }
        try {
            const creatorClient = await this.main.clientFactory.getClientForSlackUser(teamId, channelItem.creator);
            if (!creatorClient) {
                throw Error("no-client");
            }
            await creatorClient.client.conversations.invite({
                users: teamInfo.user_id,
                channel: channelItem.id,
            });
        } catch (ex) {
            log.warn("Couldn't invite bot to channel", ex);
            try {
                await client.chat.postEphemeral({
                    user: channelItem.creator,
                    text: `Hint: To bridge to Matrix, run the \`/invite @${user.name}\` command in this channel.`,
                    channel: channelItem.id,
                });
            } catch (error) {
                log.warn("Couldn't send a notice either");
                log.debug(error);
            }
        }

        let members: string[] = [];
        if (channelItem.is_private) {
            members = await this.mapChannelMembershipToMatrixIds(teamId, client, channelItem.id);
        }

        // Create the room.
        const roomId = await this.createRoomForChannel(teamId, channelItem.creator, channelItem, !channelItem.is_private, members);
        await this.main.actionLink({
            matrix_room_id: roomId,
            slack_channel_id: channelItem.id,
            team_id: teamId,
        });
        return roomId;
    }

    private async createRoomForChannel(teamId: string, creator: string, channel: ConversationsInfo,
        isPublic = true, inviteList: string[] = []): Promise<string> {
        let intent;
        let creatorUserId: string|undefined;
        try {
            creatorUserId = (await this.main.ghostStore.get(creator, undefined, teamId)).userId;
            intent = this.main.getIntent(creatorUserId);
        } catch (ex) {
            // Couldn't get the creator's mxid, using the bot.
            intent = this.main.botIntent;
        }
        const aliasPrefix = this.getAliasPrefix(teamId);
        const alias = aliasPrefix ? `${aliasPrefix}${channel.name.toLowerCase()}` : undefined;
        let topic: undefined|string;
        if (channel.purpose) {
            topic = channel.purpose.value;
        }
        log.debug("Creating new room for channel", channel.name, topic, alias);
        const plUsers = {};
        plUsers[this.main.botUserId] = 100;
        if (creatorUserId) {
            plUsers[creatorUserId] = 100;
        }
        inviteList = inviteList.filter((s) => s !== creatorUserId || s !== this.main.botUserId);
        inviteList.push(this.main.botUserId);
        const extraContent: Record<string, unknown>[] = [];
        if (this.main.encryptRoom && !isPublic) {
            extraContent.push({
                type: "m.room.encryption",
                state_key: "",
                content: {
                    algorithm: "m.megolm.v1.aes-sha2",
                }
            });
        }
        extraContent.push({
            content: {
                users: plUsers,
                users_default: 0,
                events: {
                    "m.room.name": 50,
                    "m.room.power_levels": 100,
                    "m.room.history_visibility": 100,
                    "m.room.encryption": 100,
                    "m.room.canonical_alias": 50,
                    "m.room.avatar": 50,
                },
                events_default: 0,
                state_default: 50,
                ban: 50,
                kick: 50,
                redact: 50,
                invite: 0,
            },
            state_key: "",
            type: "m.room.power_levels",
        });
        const {room_id} = await intent.createRoom({
            createAsClient: true,
            options: {
                name: `#${channel.name}`,
                topic,
                visibility: isPublic ? "public" : "private",
                room_alias_name: alias,
                preset: isPublic ? "public_chat" : "private_chat",
                invite: inviteList,
                initial_state: extraContent,
            },
        });
        log.info("Created new room for channel:", room_id);
        return room_id;
    }

    private async mapChannelMembershipToMatrixIds(teamId: string, webClient: WebClient, channelId: string) {
        const team = await this.main.datastore.getTeam(teamId);
        if (!team || !team.domain) {
            throw Error("No team domain!");
        }
        const memberset: Set<string> = new Set();
        let cursor: string|undefined;
        while (cursor !== "") {
            const membersRes = (await webClient.conversations.members({
                channel: channelId, limit: 1000, cursor,
            })) as ConversationsMembersResponse;
            membersRes.members.forEach(memberset.add.bind(memberset));
            cursor = membersRes.response_metadata.next_cursor;
        }
        const matrixIds: string[] = [];
        for (const member of memberset) {
            const mxid = await this.main.datastore.getPuppetMatrixUserBySlackId(teamId, member);
            if (mxid) {
                matrixIds.push(mxid);
            }
        }
        return matrixIds;
    }

    private async ensureBotInChannel(channel: string, teamId: string) {
        log.debug(`Ensuring the bot is in ${channel}`);
        const team = await this.main.datastore.getTeam(teamId);
        if (!team) {
            throw Error("Team not found");
        }
        const botClient = await this.main.clientFactory.getTeamClient(teamId);
        const memberList = await botClient.conversations.members({channel, limit: 1000}) as ConversationsMembersResponse;
        if (memberList.members.includes(team.user_id)) {
            log.debug(`Already in ${channel}`);
            return;
        }
        // User NOT in room, let's try to invite them.
        let client: {client: WebClient, id: string}|null = null;
        for (const member of (memberList.members)) {
            client = await this.main.clientFactory.getClientForSlackUser(teamId, member);
            if (client) {
                break;
            }
        }
        if (!client) {
            throw Error("Could not find a client to invite the user");
        }
        try {
            await client.client.conversations.invite({ channel, users: team.user_id });
            log.info(`Bot joined to ${channel}`);
        } catch (ex) {
            throw Error("Failed to invite the bot to the room");
        }
    }
}
