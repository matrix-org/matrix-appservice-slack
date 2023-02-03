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

import { NextFunction, Response } from "express";
import { ApiError, AppService, ErrCode, Logger, ProvisioningApi, ProvisioningRequest } from "matrix-appservice-bridge";

import { Main } from "../Main";
import { HTTP_CODES } from "../BaseSlackHandler";
import { AuthTestResponse, ConversationsInfoResponse, ConversationsListResponse } from "../SlackResponses";
import { NedbDatastore } from "../datastore/NedbDatastore";
import {
    isValidGetAuthUrlBody,
    isValidGetChannelInfoBody,
    isValidGetLinkBody,
    isValidLinkBody,
    isValidListChannelsBody,
    isValidLogoutBody,
    isValidUnlinkBody,
    SlackErrCode,
    SlackProvisioningError,
    ValidationError
} from "./Schema";

const log = new Logger("Provisioning");

export interface ProvisionerConfig {
    enabled: boolean;
    http?: {
        port: number;
        host?: string;
    };
    secret?: string,
    ratelimit?: boolean,
    open_id_disallowed_ip_ranges?: string[];
    open_id_overrides?: Record<string, string>;
    require_public_room?: boolean;
    allow_private_channels?: boolean;
    limits?: {
        team_count?: number;
        room_count?: number;
    };
    channel_adl?: {
        allow: string[];
        deny: string[];
    },
}

interface StrictProvisionerConfig extends ProvisionerConfig {
    secret: string;
}

const assertUserId = (req: ProvisioningRequest): string => {
    const userId = req.userId;
    if (!userId) {
        throw new ApiError("Missing user ID", ErrCode.BadValue);
    }
    return userId;
};

type RequestHandler = (req: ProvisioningRequest, res: Response, next?: NextFunction) => Promise<unknown>;

export class Provisioner extends ProvisioningApi {
    constructor(
        readonly main: Main,
        readonly appService: AppService,
        readonly config: StrictProvisionerConfig,
    ) {
        super(
            main.datastore,
            {
                provisioningToken: config.secret,
                apiPrefix: "/_matrix/provision",
                ratelimit: config.ratelimit,
                disallowedIpRanges: config.open_id_disallowed_ip_ranges,
                openIdOverride: config.open_id_overrides
                    ? Object.fromEntries(Object.entries(config.open_id_overrides)
                        .map(([id, url]) => [id, new URL(url)])
                    )
                    : undefined,
                widgetTokenPrefix: "slackbr-wdt-",
                widgetFrontendLocation: "public",
                // Use the bridge express application unless a config was specified for provisioning
                expressApp: config.http ? undefined : appService.expressApp,
            },
        );

        if (!config.enabled) {
            log.info("Provisioning disabled, endpoints will respond with an error code");
            // Disable all provision endpoints, responding with an error instead
            this.baseRoute.use((req, res, next) => next(new ApiError("Provisioning not enabled", ErrCode.DisabledFeature)));
            return;
        }

        if (this.store instanceof NedbDatastore) {
            log.warn(
                "Provisioner is incompatible with NeDB store. Widget requests will not be handled."
            );
        }

        const wrapHandler = (handler: RequestHandler) =>
            async (req: ProvisioningRequest, res: Response) => {
                // Wrap handlers so that they can follow the common style of `return res.json(...)`
                // This is only necessary because ProvisioningApi requires return of Promise<void>
                try {
                    await handler.call(this, req, res);
                } catch (e) {
                    if (res.headersSent) {
                        return;
                    }
                    if (e instanceof SlackProvisioningError || e instanceof ApiError) {
                        e.apply(res);
                    } else {
                        req.log.error("Unknown error:", e);
                        // Send a generic error
                        const err = new ApiError("An internal error occurred");
                        err.apply(res);
                    }
                }
            };

        this.addRoute("post", "/getbotid", wrapHandler(this.getBotId), "getBotId");
        this.addRoute("post", "/authurl", wrapHandler(this.getAuthUrl), "getAuthUrl");
        this.addRoute("post", "/logout", wrapHandler(this.logout), "logout");
        this.addRoute("post", "/channels", wrapHandler(this.listChannels), "listChannels");
        this.addRoute("post", "/teams", wrapHandler(this.listTeams), "listTeams");
        this.addRoute("post", "/accounts", wrapHandler(this.listAccounts), "listAccounts");
        this.addRoute("post", "/getlink", wrapHandler(this.getLink), "getLink");
        this.addRoute("post", "/channelinfo", wrapHandler(this.getChannelInfo), "getChannelinfo");
        this.addRoute("post", "/link", wrapHandler(this.link), "link");
        this.addRoute("post", "/unlink", wrapHandler(this.unlink), "unlink");
    }

    public async start(): Promise<void> {
        if (this.config.http) {
            await super.start(this.config.http.port, this.config.http.host);
        }
        log.info("Provisioning API ready");
    }

    private async reachedRoomLimit(): Promise<boolean> {
        if (!this.main.config.provisioning?.limits?.room_count) {
            // No limit applied
            return false;
        }
        const currentCount = await this.main.datastore.getRoomCount();
        return (currentCount >= this.main.config.provisioning?.limits?.room_count);
    }

    private async determineSlackIdForRequest(matrixUserId: string, teamId: string): Promise<string | undefined> {
        for (const account of await this.main.datastore.getAccountsForMatrixUser(matrixUserId)) {
            if (account.teamId === teamId) {
                return account.slackId;
            }
        }
        return undefined;
    }

    private async getBotId(req: ProvisioningRequest, res: Response) {
        const hasRoomLimit = this.main.config.provisioning?.limits?.room_count;
        const hasTeamLimit = this.main.config.provisioning?.limits?.team_count;
        return res.json({
            bot_user_id: this.main.botUserId,
            require_public_room: this.main.config.provisioning?.require_public_room || false,
            instance_name: this.main.config.homeserver.server_name,
            room_limit: hasRoomLimit ? {
                quota: this.main.config.provisioning?.limits?.room_count,
                current: await this.main.datastore.getRoomCount(),
            } : null,
            team_limit: hasTeamLimit ? {
                quota: this.main.config.provisioning?.limits?.team_count,
                current: this.main.clientFactory.teamClientCount,
            } : null,
        });
    }

    private async getAuthUrl(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidGetAuthUrlBody(body)) {
            throw new ValidationError(isValidGetAuthUrlBody);
        }

        if (!this.main.oauth2) {
            throw new ApiError(
                "OAuth2 is not configured on this bridge",
                ErrCode.UnsupportedOperation,
            );
        }
        const token = this.main.oauth2.getPreauthToken(userId);
        const authUri = this.main.oauth2.makeAuthorizeURL(
            token,
            token,
            body.puppeting,
        );
        return res.json({
            auth_uri: authUri,
        });
    }

    private async logout(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidLogoutBody(body)) {
            throw new ValidationError(isValidLogoutBody);
        }

        const slackId = body.slack_id;

        if (!this.main.oauth2) {
            throw new ApiError(
                "OAuth2 is not configured on this bridge",
                ErrCode.UnsupportedOperation,
            );
        }
        const logoutResult = await this.main.logoutAccount(userId, slackId);
        return res.json({ logoutResult });
    }

    private async listChannels(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidListChannelsBody(body)) {
            throw new ValidationError(isValidListChannelsBody);
        }

        const teamId = body.team_id;

        const accounts = await this.main.datastore.getAccountsForMatrixUser(userId);
        if (accounts.length === 0) {
            throw new SlackProvisioningError(
                "No Slack accounts found",
                SlackErrCode.UnknownAccount,
            );
        }
        const slackUser = accounts.find(a => a.teamId === teamId);
        if (!slackUser) {
            throw new SlackProvisioningError(
                "User is not in this team",
                SlackErrCode.UnknownTeam,
            );
        }
        const team = await this.main.datastore.getTeam(teamId);
        if (team === null) {
            throw new SlackProvisioningError(
                "Team was not found",
                SlackErrCode.UnknownTeam,
            );
        }
        const cli = await this.main.clientFactory.getTeamClient(teamId);
        try {
            let types = "public_channel";
            // Unless we *explicity* set this to false, allow it.
            if (this.main.config.provisioning?.allow_private_channels !== false) {
                types = `public_channel,private_channel`;
            }
            const response = (await cli.users.conversations({
                exclude_archived: true,
                limit: 1000, // TODO: Pagination
                user: slackUser.slackId,  // In order to show private channels, we need the identity of the caller.
                types,
            })) as ConversationsListResponse;
            if (!response.ok) {
                throw Error(response.error);
            }

            return res.json({
                channels: response.channels.map((chan) => ({
                    // We deliberately filter out extra information about a channel here
                    id: chan.id,
                    name: chan.name,
                    purpose: chan.purpose,
                    topic: chan.topic,
                })),
            });
        } catch (e) {
            req.log.error(`Failed to list channels for team ${teamId}:`,  e);
            throw new ApiError(
                "Failed to list channels",
                ErrCode.Unknown,
            );
        }
    }

    private async listTeams(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const accounts = await this.main.datastore.getAccountsForMatrixUser(userId);
        if (accounts.length === 0) {
            throw new SlackProvisioningError(
                "No Slack accounts found",
                SlackErrCode.UnknownAccount,
            );
        }
        const results = await Promise.all(
            accounts.map(async (account) => {
                const team = await this.main.datastore.getTeam(account.teamId);
                return {team, slack_id: account.slackId};
            })
        );
        const teams = results.map((account) => ({
            id: account.team?.id,
            name: account.team?.name,
            slack_id: account.slack_id,
        }));
        return res.json({ teams });
    }

    private async listAccounts(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const allPuppets = await this.main.datastore.getPuppetedUsers();
        const accts = allPuppets.filter((p) => p.matrixId === userId);
        const accounts = await Promise.all(accts.map(async acct => {
            const publicAccount: Record<string, unknown> = {
                matrixId: acct.matrixId,
                slackId: acct.slackId,
                teamId: acct.teamId,
            };
            const client = await this.main.clientFactory.getClientForUser(acct.teamId, acct.matrixId);
            if (client) {
                try {
                    const identity = (await client.auth.test()) as AuthTestResponse;
                    publicAccount.identity = {
                        team: identity.team,
                        name: identity.user,
                    };
                    publicAccount.isLast = allPuppets.filter((t) => t.teamId).length < 2;
                } catch (ex) {
                    return acct;
                }
            }
            return publicAccount;
        }));
        return res.json({ accounts });
    }

    private async getLink(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidGetLinkBody(body)) {
            throw new ValidationError(isValidGetLinkBody);
        }

        const matrixRoomId = body.matrix_room_id;

        const room = this.main.rooms.getByMatrixRoomId(matrixRoomId);
        if (!room) {
            throw new SlackProvisioningError(
                "Link not found",
                SlackErrCode.UnknownLink,
            );
        }

        const allowed = await this.main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw new SlackProvisioningError(
                "Not allowed to provision links in this room",
                SlackErrCode.NotEnoughPower,
            );
        }

        // Convert the room 'status' into an integration manager 'status'
        let status = room.getStatus();
        if (status.match(/^ready/)) {
            // OK
        } else if (status === "pending-params") {
            status = "partial";
        } else if (status === "pending-name") {
            status = "pending";
        } else {
            status = "unknown";
        }

        return res.json({
            inbound_uri: this.main.getInboundUrlForRoom(room),
            isWebhook: room.SlackWebhookUri !== undefined,
            matrix_room_id: matrixRoomId,
            slack_channel_id: room.SlackChannelId,
            slack_channel_name: room.SlackChannelName,
            slack_webhook_uri: room.SlackWebhookUri,
            status,
            team_id: room.SlackTeamId,
        });
    }

    private async getChannelInfo(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidGetChannelInfoBody(body)) {
            throw new ValidationError(isValidGetChannelInfoBody);
        }

        const channelId = body.channel_id;
        const teamId = body.team_id;

        // Check if the user is in the team.
        if (!(await this.main.matrixUserInSlackTeam(teamId, userId))) {
            throw new SlackProvisioningError(
                "User is not in this team",
                SlackErrCode.UnknownTeam,
            );
        }

        let channelInfo: ConversationsInfoResponse|"channel_not_allowed"|"channel_not_found";
        try {
            channelInfo = await this.main.getChannelInfo(channelId, teamId);
        } catch (error) {
            req.log.error("Failed to get channel info:", error);
            throw new ApiError(
                "Failed to get channel info",
                ErrCode.Unknown,
            );
        }

        if (channelInfo === "channel_not_found") {
            throw new SlackProvisioningError(
                "Slack channel was not found",
                SlackErrCode.UnknownChannel,
            );
        } else if (channelInfo === "channel_not_allowed") {
            throw new SlackProvisioningError(
                "Slack channel is not allowed to be bridged",
                SlackErrCode.UnknownChannel,
            );
        } else {
            return res.json({
                name: channelInfo.channel.name,
                memberCount: channelInfo.channel.num_members,
            });
        }
    }

    private async link(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidLinkBody(body)) {
            throw new ValidationError(isValidLinkBody);
        }

        const matrixRoomId = body.matrix_room_id;
        const teamId = body.team_id;
        const channelId = body.channel_id;
        const slackWebhookUri = body.slack_webhook_uri;

        // Ensure we are in the room.
        await this.main.botIntent.join(matrixRoomId);

        // Check if the user is in the team.
        if (teamId && !(await this.main.matrixUserInSlackTeam(teamId, userId))) {
            throw new SlackProvisioningError(
                "User is not in this team",
                SlackErrCode.UnknownTeam,
            );
        }
        if (!(await this.main.checkLinkPermission(matrixRoomId, userId))) {
            throw new SlackProvisioningError(
                "User is not allowed to provision links in this room",
                SlackErrCode.NotEnoughPower,
            );
        }

        if (await this.reachedRoomLimit()) {
            throw new SlackProvisioningError(
                "Maximum number of bridged rooms has been reached",
                SlackErrCode.BridgeAtLimit,
            );
        }

        try {
            const room = await this.main.actionLink({
                matrix_room_id: matrixRoomId,
                slack_webhook_uri: slackWebhookUri,
                slack_channel_id: channelId,
                team_id: teamId,
            });
            // Convert the room 'status' into an integration manager 'status'
            let status = room.getStatus();
            if (status === "ready") {
                // OK
            } else if (status === "pending-params") {
                status = "partial";
            } else if (status === "pending-name") {
                status = "pending";
            } else {
                status = "unknown";
            }
            req.log.info(`Result of link for ${matrixRoomId} -> ${status} ${channelId}`);
            return res.json({
                inbound_uri: this.main.getInboundUrlForRoom(room),
                matrix_room_id: matrixRoomId,
                slack_channel_name: room.SlackChannelName,
                slack_webhook_uri: room.SlackWebhookUri,
                status,
            });
        } catch (e) {
            req.log.error(`Failed to link room ${matrixRoomId} to channel ${channelId}:`, e);
            // TODO We could be more specific if actionLink returned different errors
            throw new ApiError(
                "Failed to link channel",
                ErrCode.Unknown,
            );
        }
    }

    private async unlink(req: ProvisioningRequest, res: Response) {
        const userId = assertUserId(req);

        const body = req.body as unknown;
        if (!isValidUnlinkBody(body)) {
            throw new ValidationError(isValidUnlinkBody);
        }

        const matrixRoomId = body.matrix_room_id;

        const allowed = await this.main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw new SlackProvisioningError(
                "User is not allowed to provision links in this room",
                SlackErrCode.NotEnoughPower,
            );
        }
        await this.main.actionUnlink({matrix_room_id: matrixRoomId});
        return res.json({});
    }
}
