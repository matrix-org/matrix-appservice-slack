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

const log = Logging.get("TeamSyncer");

export interface ITeamSyncConfig {
    channels?: {
        enabled: boolean;
        whitelist?: string[];
        blacklist?: string[];
        alias_prefix?: string;
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
        this.teamConfigs = config.team_sync;
    }

    public async syncAllTeams(teamClients: { [id: string]: WebClient; }) {
        const queue = new PQueue({concurrency: TEAM_SYNC_CONCURRENCY});
        const functionsForQueue: (() => Promise<void>)[] = [];
        for (const [teamId, client] of Object.entries(teamClients)) {
            if (!this.getTeamSyncConfig(teamId)) {
                log.debug(`Not syncing ${teamId}, team is not configured to sync`);
                continue;
            }
            functionsForQueue.push(async () => {
                log.info("Syncing team", teamId);
                await this.syncItems(teamId, client, "user");
                await this.syncItems(teamId, client, "channel");
            });
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

    public async syncItems(teamId: string, client: WebClient, type: "user"|"channel") {
        if (!this.getTeamSyncConfig(teamId, type)) {
            log.warn(`Not syncing ${type}s for ${teamId}`);
            return;
        }
        // tslint:disable-next-line: no-any
        let itemList: any[] = [];
        let cursor: string|undefined;
        for (let i = 0; i < TEAM_SYNC_FAILSAFE && (cursor === undefined || cursor !== ""); i++) {
            let res: ConversationsListResponse|UsersListResponse;
            if (type === "channel") {
                res = (await client.conversations.list({
                    limit: 1000,
                    exclude_archived: true,
                    type: "public_channel",
                    cursor,
                })) as ConversationsListResponse;
                itemList = itemList.concat(res.channels);
            } else {
                res = (await client.users.list({
                    limit: 1000,
                    cursor,
                })) as UsersListResponse;
                itemList = itemList.concat(res.members);
            }

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
        log.info(`Found ${itemList.length} total ${type}s`);
        const team = await this.main.datastore.getTeam(teamId);
        if (!team || !team.domain) {
            throw Error("No team domain!");
        }
        // Create all functions that will create promises.
        // With .bind(this, ...params) they won't immediately execute.
        const syncFunctionPromises = itemList.map(item => (
            (type === "channel")
                ? this.syncChannel.bind(this, teamId, item)
                : this.syncUser.bind(this, teamId, team.domain, item)
        ));
        const queue = new PQueue({ concurrency: TEAM_SYNC_ITEM_CONCURRENCY });
        // .addAll waits for all promises to resolve.
        await queue.addAll(syncFunctionPromises);
    }

    private getTeamSyncConfig(teamId: string, item?: "channel"|"user", itemId?: string) {
        const teamConfig = this.teamConfigs[teamId] || this.teamConfigs.all;
        if (!teamConfig) {
            return false;
        }
        if (item === "channel" && (!teamConfig.channels || !teamConfig.channels.enabled)) {
            return false;
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

    public async onChannelAdded(teamId: string, channelId: string, name: string, creator: string) {
        log.info(`${teamId} ${creator} created channel ${channelId} ${name}`);
        const client = await this.main.clientFactory.getTeamClient(teamId);
        const { channel } = (await client.conversations.info({ channel: channelId })) as ConversationsInfoResponse;
        await this.syncChannel(teamId, channel);
    }

    public async onDiscoveredPrivateChannel(teamId: string, client: WebClient, chanInfo: ConversationsInfoResponse) {
        log.info(`Discovered private channel ${teamId} ${chanInfo.channel.id}`);
        const channelItem = chanInfo.channel;
        if (!this.getTeamSyncConfig(teamId, "channel", channelItem.id)) {
            log.info(`Not syncing`);
            return;
        }
        const existingChannel = this.main.rooms.getBySlackChannelId(channelItem.id);
        if (existingChannel) {
            log.debug("Channel already exists in datastore, not bridging");
            return;
        }
        if (channelItem.is_im || channelItem.is_mpim || !channelItem.is_private) {
            log.warn("Not creating channel: Is not a private channel");
            return;
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
            }, undefined, client);
            room.updateUsingChannelInfo(chanInfo);
            this.main.rooms.upsertRoom(room);
            await this.main.datastore.upsertRoom(room);
        } catch (ex) {
            log.error("Failed to provision new room dynamically:", ex);
        }
    }

    public async syncUser(teamId: string, domain: string, item: ISlackUser) {
        log.info(`Syncing user ${teamId} ${item.id}`);
        const slackGhost = await this.main.ghostStore.get(item.id, domain, teamId);
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
        let i = this.main.rooms.all.length;
        await Promise.all(this.main.rooms.all.map((r) =>
            slackGhost.intent.leave(r.MatrixRoomId).catch((ex) => {
                i--;
                // Failing to leave a room is fairly normal.
            }),
        ));
        log.info(`Left ${i} rooms`);
        return;
    }

    private async syncChannel(teamId: string, channelItem: ConversationsInfo) {
        log.info(`Syncing channel ${teamId} ${channelItem.id}`);
        if (!this.getTeamSyncConfig(teamId, "channel", channelItem.id)) {
            return;
        }

        const client = await this.main.clientFactory.getTeamClient(teamId);
        const existingChannel = this.main.rooms.getBySlackChannelId(channelItem.id);
        let roomId: string;
        if (!existingChannel) {
            if (!channelItem.is_channel || channelItem.is_private) {
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
            if (channelItem.is_private === false) {
                await this.ensureBotInChannel(channelItem.id, teamId);
            }
            await this.syncMembershipForRoom(roomId, channelItem.id, teamId, client);
        } catch (ex) {
            log.error("Failed to sync membership to room:", ex);
            return;
        }
    }

    public async onChannelDeleted(teamId: string, channelId: string) {
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

    private async syncMembershipForRoom(roomId: string, channelId: string, teamId: string, client: WebClient) {
        const existingGhosts = await this.main.listGhostUsers(roomId);
        // We assume that we have this
        const teamInfo = (await this.main.datastore.getTeam(teamId))!;
        // Finally, sync membership for the channel.
        const members = await client.conversations.members({channel: channelId}) as ConversationsMembersResponse;
        // Ghosts will exist already: We joined them in the user sync.
        const ghosts = await Promise.all(members.members.map((slackUserId) => this.main.ghostStore.get(slackUserId, teamInfo.domain, teamId)));

        const joinedUsers = ghosts.filter((g) => !existingGhosts.includes(g.userId)); // Skip users that are joined.
        const leftUsers = existingGhosts.filter((userId) => !ghosts.find((g) => g.userId === userId ));
        log.info(`Joining ${joinedUsers.length} ghosts to ${roomId}`);
        log.info(`Leaving ${leftUsers.length} ghosts to ${roomId}`);

        const queue = new PQueue({concurrency: JOIN_CONCURRENCY});

        // Join users who aren't joined
        joinedUsers.forEach((g) => queue.add(() => g.intent.join(roomId)));

        // Leave users who are joined
        leftUsers.forEach((userId) => queue.add(() => this.main.getIntent(userId).leave(roomId)));

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
        const teamInfo = (await this.main.datastore.getTeam(teamId))!;
        log.info(`Attempting to dynamically bridge ${channelItem.id} ${channelItem.name}`);
        const {user} = (await client.users.info({ user: teamInfo.user_id })) as UsersInfoResponse;
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
                    text: `Hint: To bridge to Matrix, run the \`/invite @${user!.name}\` command in this channel.`,
                    channel: channelItem.id,
                });
            } catch (ex) {
                log.warn("Couldn't send a notice either");
            }
        }

        // Create the room.
        let roomId: string;
        try {
            roomId = await this.createRoomForChannel(teamId, channelItem.creator, channelItem);
            await this.main.actionLink({
                matrix_room_id: roomId,
                slack_channel_id: channelItem.id,
                team_id: teamId,
            });
            return roomId;
        } catch (ex) {
            throw ex;
        }
    }

    private async createRoomForChannel(teamId: string, creator: string, channel: ConversationsInfo,
                                       isPublic: boolean = true, inviteList: string[] = []): Promise<string> {
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
        const {room_id} = await intent.createRoom({
            createAsClient: true,
            options: {
                name: `#${channel.name}`,
                topic,
                visibility: isPublic ? "public" : "private",
                room_alias: alias,
                preset: isPublic ? "public_chat" : "private_chat",
                invite: inviteList,
                initial_state: [{
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
                }],
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
