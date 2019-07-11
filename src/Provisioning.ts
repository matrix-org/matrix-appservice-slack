import { Logging, Bridge, MatrixUser } from "matrix-appservice-bridge";
import * as rp from "request-promise-native";
import { Request, Response} from "express";

import { Main } from "./Main";
import { HTTP_CODES } from "./BaseSlackHandler";

const log = Logging.get("Provisioning");

type CommandFunc = (main: Main, req: Request, res: Response, ...params: string[]) => void|Promise<void>;
export const commands: {[verb: string]: Command} = {};

type Param = string;

export class Command {
    private params: Param[];
    private func: CommandFunc;
    constructor(opts: {params: Param[], func: CommandFunc}) {
        this.params = opts.params;
        this.func = opts.func;
    }

    public async run(main: Main, req: Request, res: Response) {
        const body = req.body;
        const args: [Main, Request, Response, ...string[]] = [main, req, res];
        for (const param of this.params) {
            if (!(param in body)) {
                res.status(HTTP_CODES.CLIENT_ERROR).json({error: `Required parameter ${param} missing`});
                return;
            }

            args.push(body[param]);
        }

        try {
            await this.func.apply(this, args);
        } catch (err) {
            log.error("Provisioning command threw an error:", err);
            res.status(err.code || HTTP_CODES.SERVER_ERROR).json({error: err.text || err.message || err});
        }
    }
}

export async function handle(main: Main, verb: string, req: Request, res: Response) {
    const prov = commands[verb];

    if (!prov) {
        res.status(HTTP_CODES.NOT_FOUND).json({error: "Unrecognised provisioning command " + verb});
        return;
    }
    try {
        await prov.run(main, req, res);
    } catch (e) {
        log.error("Provisioning command failed:", e);
        res.status(HTTP_CODES.SERVER_ERROR).json({error: "Provisioning command failed " + e});
    }
}

export function addAppServicePath(bridge: Bridge, main: Main) {
    bridge.addAppServicePath({
        handler: async (req: Request, res: Response) => {
            const verb = req.params.verb;
            log.info("Received a _matrix/provision request for " + verb);
            await handle(main, verb, req, res);
        },
        method: "POST",
        path: "/_matrix/provision/:verb",
    });
}

commands.getbotid = new Command({
    params: [],
    func(main, req, res) {
        res.json({bot_user_id: main.botUserId});
    },
});

commands.authlog = new Command({
    params: ["user_id"],
    func(main, req, res, userId) {
        if (!main.oauth2) {
            res.status(HTTP_CODES.CLIENT_ERROR).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const token = main.oauth2.getPreauthToken(userId);
        const authUri = main.oauth2.makeAuthorizeURL(
            token,
            token,
        );
        res.json({
            auth_uri: authUri,
        });
    },
});

commands.logout = new Command({
    params: ["user_id", "slack_id"],
    async func(main, req, res, userId, slackId) {
        if (!main.oauth2) {
            res.status(HTTP_CODES.NOT_FOUND).json({
                error: "OAuth2 not configured on this bridge",
            });
            return;
        }
        const store = main.userStore;
        let matrixUser = await store.getMatrixUser(userId);
        matrixUser = matrixUser ? matrixUser : new MatrixUser(userId);
        const accounts = matrixUser.get("accounts") || {};
        delete accounts[slackId];
        matrixUser.set("accounts", accounts);
        store.setMatrixUser(matrixUser);
        log.info(`Removed account ${slackId} from ${slackId}`);
    },
});

commands.channels = new Command({
    params: ["user_id", "team_id"],
    async func(main, req, res, userId, teamId) {
        const store = main.userStore;
        log.debug(`${userId} requested their teams`);
        main.incRemoteCallCounter("conversations.list");
        const matrixUser = await store.getMatrixUser(userId);
        const isAllowed = matrixUser !== null &&
            Object.values(matrixUser.get("accounts") as {[key: string]: {team_id: string}}).find((acct) =>
                acct.team_id === teamId,
            );
        if (!isAllowed) {
            res.status(HTTP_CODES.CLIENT_ERROR).json({error: "User is not part of this team!"});
            throw undefined;
        }
        const team = await main.getTeamFromStore(teamId);
        if (team === null) {
            throw new Error("No team token for this team_id");
        }
        const response = await rp({
            json: true,
            qs: {
                exclude_archived: true,
                limit: 100,
                token: team.bot_token,
                types: "public_channel",
            },
            url: "https://slack.com/api/conversations.list",
        });
        if (!response.ok) {
            log.error(`Failed trying to fetch channels for ${teamId}.`, response);
            res.status(HTTP_CODES.SERVER_ERROR).json({error: "Failed to fetch channels"});
            return;
        }
        res.json({
            channels: response.channels.map((chan) => ({
                id: chan.id,
                name: chan.name,
                purpose: chan.purpose,
                topic: chan.topic,
            })),
        });
    },
});

commands.teams = new Command({
    params: ["user_id"],
    async func(main, req, res, userId) {
        log.debug(`${userId} requested their teams`);
        const store = main.userStore;
        const matrixUser = await store.getMatrixUser(userId);
        if (matrixUser === null) {
            res.status(HTTP_CODES.NOT_FOUND).json({error: "User has no accounts setup"});
            return;
        }
        const accounts = matrixUser.get("accounts");
        const results = await Promise.all(Object.keys(accounts).map(async (slackId) => {
            const account = accounts[slackId];
            return main.getTeamFromStore(account.team_id).then(
                (team) => ({team, slack_id: slackId}),
            );
        }));
        const teams = results.map((account) => ({
            id: account.team.team_id,
            name: account.team.team_name,
            slack_id: account.slack_id,
        }));
        res.json({ teams });
    },
});

commands.getlink = new Command({
    params: ["matrix_room_id", "user_id"],
    async func(main, req, res, matrixRoomId, userId) {
        const room = main.getRoomByMatrixRoomId(matrixRoomId);
        if (!room) {
            res.status(HTTP_CODES.NOT_FOUND).json({error: "Link not found"});
            return;
        }

        log.info(`Need to enquire if ${userId} is allowed get links for ${matrixRoomId}`);
        const allowed = await main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw {
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            };
        }

        // Convert the room 'status' into a scalar 'status'
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
        if (main.oauth2 && !room.AccessToken) {
            // We don't have an auth token but we do have the ability
            // to ask for one
            authUri = main.oauth2.makeAuthorizeURL(
                room,
                room.InboundId,
            );
        }

        res.json({
            auth_uri: authUri,
            inbound_uri: main.getInboundUrlForRoom(room),
            isWebhook: !room.SlackBotId,
            // This is slightly a lie
            matrix_room_id: matrixRoomId,
            slack_channel_id: room.SlackChannelId,
            slack_channel_name: room.SlackChannelName,
            slack_webhook_uri: room.SlackWebhookUri,
            status,
            team_id: room.SlackTeamId,
        });
    },
});

commands.link = new Command({
    params: ["matrix_room_id", "user_id"],
    async func(main, req, res, matrixRoomId, userId) {
        log.info(`Need to enquire if ${userId} is allowed to link ${matrixRoomId}`);

        // Ensure we are in the room.
        await main.botIntent.join(matrixRoomId);

        const params = req.body;
        const opts = {
            matrix_room_id: matrixRoomId,
            slack_channel_id: params.channel_id,
            slack_webhook_uri: params.slack_webhook_uri,
            team_id: params.team_id,
            user_id: params.user_id,
        };

        // Check if the user is in the team.
        if (opts.team_id && !(await main.matrixUserInSlackTeam(opts.team_id, opts.user_id))) {
            return Promise.reject({
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not in this team.`,
            });
        }
        if (!(await main.checkLinkPermission(matrixRoomId, userId))) {
            return Promise.reject({
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            });
        }
        const room = await main.actionLink(opts);
        // Convert the room 'status' into a scalar 'status'
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
            inbound_uri: main.getInboundUrlForRoom(room),
            matrix_room_id: matrixRoomId,
            slack_channel_name: room.SlackChannelName,
            slack_webhook_uri: room.SlackWebhookUri,
            status,
        });
    },
});

commands.unlink = new Command({
    params: ["matrix_room_id", "user_id"],
    async func(main, req, res, matrixRoomId, userId) {
        log.info(`Need to enquire if ${userId} is allowed to unlink ${matrixRoomId}`);

        const allowed = await main.checkLinkPermission(matrixRoomId, userId);
        if (!allowed) {
            throw {
                code: HTTP_CODES.FORBIDDEN,
                text: `${userId} is not allowed to provision links in ${matrixRoomId}`,
            };
        }
        await main.actionUnlink({matrix_room_id: matrixRoomId});
        res.json({});
    },
// tslint:disable-next-line: max-file-line-count
});
