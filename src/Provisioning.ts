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

import { Logging, MatrixUser } from "matrix-appservice-bridge";
import { Request, Response} from "express";
import { Main } from "./Main";
import { HTTP_CODES } from "./BaseSlackHandler";
import { ConversationsListResponse, AuthTestResponse } from "./SlackResponses";

const log = Logging.get("Provisioning");

interface DecoratedCommandFunc {
    (req: Request, res: Response, ...params: string[]): void|Promise<void>;
    params: Param[];
}

type Param = string | { param: string, required: boolean};
type Verbs = "getbotid"|"authurl"|"channels"|"getlink"|"link"|"logout"|"removeaccount"|"teams"|"accounts"|"unlink";

// Decorator
const command = (...params: Param[]) => (
    (target: any, propertyKey: string) => {
        target[propertyKey].params = params;
    }
);

export class Provisioner {
    constructor(private main: Main, private bridge: any) { }

    public addAppServicePath() {
        this.bridge.addAppServicePath({
            handler: async (req: Request, res: Response) => {
                const verb = req.params.verb;
                await this.handleProvisioningRequest(verb as Verbs, req, res);
            },
            method: "POST",
            checkToken: true,
            path: "/_matrix/provision/:verb",
        });
    }

    public async handleProvisioningRequest(verb: Verbs, req: Request, res: Response) {
        const provisioningCommand = this[verb] as DecoratedCommandFunc;
        if (!provisioningCommand || !provisioningCommand.params) {
            return res.status(HTTP_CODES.NOT_FOUND).json({error: "Unrecognised provisioning command " + verb});
        }

        const body = req.body;
        const args: [Request, Response, ...string[]] = [req, res];
        for (const param of provisioningCommand.params) {
            const paramName = typeof(param) === "string" ? param : param.param;
            const paramRequired = typeof(param) === "string" ? true : param.required;
            if (!(paramName in body) && paramRequired) {
                return res.status(HTTP_CODES.CLIENT_ERROR).json({error: `Required parameter ${param} missing`});
            }

            args.push(body[paramName]);
        }

        try {
            return await provisioningCommand.call(this, ...args);
        } catch (err) {
            log.error("Provisioning command threw an error:", err);
            res.status(err.code || HTTP_CODES.SERVER_ERROR).json({error: err.text || err.message || err});
        }
    }

    private async reachedRoomLimit() {
        if (!this.main.config.provisioning?.limits?.room_count) {
            // No limit applied
            return false;
        }
        const currentCount = await this.main.datastore.getRoomCount();
        return (currentCount >= this.main.config.provisioning?.limits?.room_count);
    }

    private async determineSlackIdForRequest(matrixUserId, teamId) {
        for (const account of await this.main.datastore.getAccountsForMatrixUser(matrixUserId)) {
            if (account.teamId === teamId) {
                return account.slackId;
            }
        }
        return null;
    }

    @command()
    private async getconfig(_, res) {
        const hasRoomLimit = this.main.config.provisioning?.limits?.room_count;
        const hasTeamLimit = this.main.config.provisioning?.limits?.team_count;
        res.json({
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

    @command()
    private async getbotid(_, res) {
        return this.getconfig(_, res);
    }

    @command("user_id", { param: "puppeting", required: false})
    private authurl(_, res, userId, puppeting) {
        if (!this.main.oauth2) {
            res.status(HTTP_CODES.CLIENT_ERROR).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const token = this.main.oauth2.getPreauthToken(userId);
        const authUri = this.main.oauth2.makeAuthorizeURL(
            token,
            token,
            puppeting === "true",
        );
        res.json({
            auth_uri: authUri,
        });
    }

    @command("user_id", "slack_id")
    private async logout(req: Request, res: Response, userId: string, slackId: string) {
        if (!this.main.oauth2) {
            res.status(HTTP_CODES.NOT_FOUND).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const logoutResult = await this.main.logoutAccount(userId, slackId);
        res.json({logoutResult});
    }

    @command("user_id", "team_id")
    private async channels(req, res, userId, teamId) {
        log.debug(`${userId} for ${teamId} requested their channels`);
        const slackUserId = await this.determineSlackIdForRequest(userId, teamId);
        if (!slackUserId) {
            return res.status(HTTP_CODES.CLIENT_ERROR).json({error: "User is not part of this team!"});
        }
        const team = await this.main.datastore.getTeam(teamId);
        if (team === null) {
            throw Error("No team token for this team_id");
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
                user: slackUserId,  // In order to show private channels, we need the identity of the caller.
                types,
            })) as ConversationsListResponse;
            if (!response.ok) {
                throw Error(response.error);
            }

            res.json({
                channels: response.channels.map((chan) => ({
                    // We deliberately filter out extra information about a channel here
                    id: chan.id,
                    name: chan.name,
                    purpose: chan.purpose,
                    topic: chan.topic,
                })),
            });
        } catch (ex) {
            log.error(`Failed trying to fetch channels for ${teamId} ${ex}.`);
            res.status(HTTP_CODES.SERVER_ERROR).json({error: "Failed to fetch channels"});
        }
    }

    @command("user_id")
    private async teams(req, res, userId) {
        log.debug(`${userId} requested their teams`);
        const accounts = await this.main.datastore.getAccountsForMatrixUser(userId);
        if (accounts.length === 0) {
            res.status(HTTP_CODES.NOT_FOUND).json({error: "User has no accounts setup"});
            return;
        }
        const results = await Promise.all(accounts.map(async (account) => {
            const team = await this.main.datastore.getTeam(account.teamId)
            return {team, slack_id: account.slackId};
        })
        );
        const teams = results.map((account) => ({
            id: account.team!.id,
            name: account.team!.name,
            slack_id: account.slack_id,
        }));
        res.json({ teams });
    }

    @command("user_id")
    private async accounts(_, res, userId) {
        log.debug(`${userId} requested their puppeted accounts`);
        const allPuppets = await this.main.datastore.getPuppetedUsers();
        const accts = allPuppets.filter((p) => p.matrixId === userId);
        const accounts = await Promise.all(accts.map(async (acct: any) => {
            delete acct.token;
            const client = await this.main.clientFactory.getClientForUser(acct.teamId, acct.matrixId);
            if (client) {
                try {
                    const identity = (await client.auth.test()) as AuthTestResponse;
                    acct.identity = {
                        team: identity.team,
                        name: identity.user,
                    };
                    acct.isLast = allPuppets.filter((t) => t.teamId).length < 2;
                } catch (ex) {
                    return acct;
                }
            }
            return acct;
        }));
        res.json({ accounts });
    }

    @command("matrix_room_id", "user_id")
    private async getlink(req, res, matrixRoomId, userId) {
        const room = this.main.rooms.getByMatrixRoomId(matrixRoomId);
        if (!room) {
            res.status(HTTP_CODES.NOT_FOUND).json({error: "Link not found"});
            return;
        }

        log.info(`Need to enquire if ${userId} is allowed get links for ${matrixRoomId}`);
        const allowed = await this.main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw {
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            };
        }

        // Convert the room 'status' into a integration manager 'status'
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

        res.json({
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

    @command("matrix_room_id", "user_id")
    private async link(req, res, matrixRoomId, userId) {
        log.info(`Need to enquire if ${userId} is allowed to link ${matrixRoomId}`);

        // Ensure we are in the room.
        await this.main.botIntent.join(matrixRoomId);

        const params = req.body;
        const opts = {
            matrix_room_id: matrixRoomId,
            slack_channel_id: params.channel_id,
            slack_webhook_uri: params.slack_webhook_uri,
            team_id: params.team_id,
            user_id: params.user_id,
        };

        // Check if the user is in the team.
        if (opts.team_id && !(await this.main.matrixUserInSlackTeam(opts.team_id, opts.user_id))) {
            return Promise.reject({
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not in this team.`,
            });
        }
        if (!(await this.main.checkLinkPermission(matrixRoomId, userId))) {
            return Promise.reject({
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            });
        }

        if (await this.reachedRoomLimit()) {
            throw {
                code: HTTP_CODES.FORBIDDEN,
                text: `You have reached the maximum number of bridged rooms.`,
            };
        }

        const room = await this.main.actionLink(opts);
        // Convert the room 'status' into a integration manager 'status'
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
        log.info(`Result of link for ${matrixRoomId} -> ${status} ${opts.slack_channel_id}`);
        res.json({
            inbound_uri: this.main.getInboundUrlForRoom(room),
            matrix_room_id: matrixRoomId,
            slack_channel_name: room.SlackChannelName,
            slack_webhook_uri: room.SlackWebhookUri,
            status,
        });
    }

    @command("matrix_room_id", "user_id")
    private async unlink(_, res, matrixRoomId, userId) {
        log.info(`Need to enquire if ${userId} is allowed to unlink ${matrixRoomId}`);

        const allowed = await this.main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw {
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            };
        }
        await this.main.actionUnlink({matrix_room_id: matrixRoomId});
        res.json({});
    }
}
