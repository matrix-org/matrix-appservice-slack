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

import { Logging, Bridge, MatrixUser } from "matrix-appservice-bridge";
import * as rp from "request-promise-native";
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
function command(...params: Param[]) {
    return (target: any, propertyKey: string) => {
        target[propertyKey].params = params;
    };
}

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
        if (!this.main.config.limits?.room_count) {
            // No limit applied
            return false;
        }
        const currentCount = await this.main.datastore.getRoomCount();
        return (currentCount >= this.main.config.limits?.room_count);
    }

    @command()
    private async getconfig(_, res) {
        res.json({
            bot_user_id: this.main.botUserId,
            reachedRoomLimit: await this.reachedRoomLimit(),
        })
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
    private async logout(req, res, userId, slackId) {
        if (!this.main.oauth2) {
            res.status(HTTP_CODES.NOT_FOUND).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        let matrixUser = await this.main.datastore.getMatrixUser(userId);
        matrixUser = matrixUser ? matrixUser : new MatrixUser(userId);
        const accounts = matrixUser.get("accounts") || {};
        delete accounts[slackId];
        matrixUser.set("accounts", accounts);
        await this.main.datastore.storeMatrixUser(matrixUser);
        log.info(`Removed account ${slackId} from ${slackId}`);
    }

    @command("user_id", "team_id")
    private async channels(req, res, userId, teamId) {
        log.debug(`${userId} for ${teamId} requested their channels`);
        const matrixUser = await this.main.datastore.getMatrixUser(userId);
        const isAllowed = matrixUser !== null &&
            Object.values(matrixUser.get("accounts") as {[key: string]: {team_id: string}}).find((acct) =>
                acct.team_id === teamId,
            );
        if (!isAllowed) {
            res.status(HTTP_CODES.CLIENT_ERROR).json({error: "User is not part of this team!"});
            throw undefined;
        }
        const team = await this.main.datastore.getTeam(teamId);
        if (team === null) {
            throw Error("No team token for this team_id");
        }
        const cli = await this.main.clientFactory.getTeamClient(teamId);
        try {
            const response = (await cli.conversations.list({
                exclude_archived: true,
                limit: 1000, // TODO: Pagination
                types: "public_channel", // TODO: In order to show private channels, we need the identity of the caller.
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
        const matrixUser = await this.main.datastore.getMatrixUser(userId);
        if (matrixUser === null) {
            res.status(HTTP_CODES.NOT_FOUND).json({error: "User has no accounts setup"});
            return;
        }
        const accounts = matrixUser.get("accounts");
        const results = await Promise.all(Object.keys(accounts).map(async (slackId) => {
            const account = accounts[slackId];
            return this.main.datastore.getTeam(account.team_id).then(
                (team) => ({team, slack_id: slackId}),
            );
        }));
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

    @command("user_id", "team_id")
    private async removeaccount(_, res, userId, teamId) {
        log.debug(`${userId} is removing their account on ${teamId}`);
        await this.main.clientFactory.removeClient(userId, teamId);
        res.json({ });
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

        let authUri;
        let stordTeamExists = room.SlackTeamId !== undefined;

        if (room.SlackTeamId) {
            stordTeamExists = (await this.main.datastore.getTeam(room.SlackTeamId)) !== null;
        }

        if (this.main.oauth2 && !stordTeamExists) {
            // We don't have an auth token but we do have the ability
            // to ask for one
            authUri = this.main.oauth2.makeAuthorizeURL(
                room,
                room.InboundId,
            );
        }

        res.json({
            auth_uri: authUri,
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
