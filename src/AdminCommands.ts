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

import { BotCommand, BotCommandHandler, CommandArguments, Logging } from "matrix-appservice-bridge";
import { AdminCommand, ResponseCallback } from "./AdminCommand";
import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";

const log = Logging.get("AdminCommands");

const RoomIdCommandOption = {
    alias: "R",
    demandOption: true,
    description: "Matrix Room ID",
};

interface CommandContext extends Record<string, unknown> {
    room_id: string;
}

export class AdminCommands {
    handler: BotCommandHandler<this, CommandContext>;

    constructor(private main: Main) {
        this.handler = new BotCommandHandler(this);
    }

    public async handle(evt: any) {
        return this.handler.handleCommand(evt.content.body, evt);
    }

    private async respond(ctx: CommandArguments<CommandContext>, message: string) {
        return this.main.botIntent.sendEvent(ctx.request.room_id, "m.room.message", {
            body: message,
            msgtype: "m.notice",
        });
    }

    @BotCommand({ name: 'list', help: 'list the linked rooms', optionalArgs: ['room', 'team'] })
    public async list(data: CommandArguments<CommandContext>) {
        const _options = {
            room: {
                alias: "R",
                description: "Filter only Matrix room IDs containing this string fragment",
            },
            team: {
                alias: "T",
                description: "Filter only rooms for this Slack team domain",
            },
        };
        //////////////////////////////////////////////////////////
        const [room, team] = data.args;

        const quotemeta = (s: string) => s.replace(/\W/g, "\\$&");
        let nameFilter: RegExp;

        if (team) {
            nameFilter = new RegExp(`^${quotemeta(team)}\\.#`);
        }

        let found = 0;
        this.main.rooms.all.forEach((r) => {
            const channelName = r.SlackChannelName || "UNKNOWN";

            if (nameFilter && !nameFilter.test(channelName)) {
                return;
            }

            if (room && !r.MatrixRoomId.includes(room)) {
                return;
            }

            const slack = r.SlackChannelId ?
                `${channelName} (${r.SlackChannelId})` :
                channelName;

            let status = r.getStatus();
            if (!status.startsWith("ready")) {
                status = status.toUpperCase();
            }

            found++;
            this.respond(data, `${status} ${slack} -- ${r.MatrixRoomId}`);
        });

        if (!found) {
            this.respond(data, "No rooms found");
        }
    }

    @BotCommand({ name: 'show', help: 'show a single connected room', requiredArgs: ['room-or-channel-id'] })
    public async show(data: CommandArguments<CommandContext>) {
        const _options = {
            channel_id: {
                alias: "I",
                description: "Slack channel ID",
            },
            room: { ...RoomIdCommandOption, demandOption: false },
        };

        const target_id = data.args[1];

        let bridgedRoom: BridgedRoom|undefined;
        if (target_id?.startsWith('!')) {
            bridgedRoom = this.main.rooms.getByMatrixRoomId(target_id);
        } else {
            bridgedRoom = this.main.rooms.getBySlackChannelId(target_id);
        }

        if (!bridgedRoom) {
            return this.respond(data, "No such room");
        }

        const response: string[] = [];

        response.push("Bridged Room:");
        response.push("  Status: " + bridgedRoom.getStatus());
        response.push("  Slack Name: " + bridgedRoom.SlackChannelName || "PENDING");
        response.push("  Slack Team: " + bridgedRoom.SlackTeamId || "PENDING");
        if (bridgedRoom.SlackWebhookUri) {
            response.push("  Webhook URI: " + bridgedRoom.SlackWebhookUri);
        }
        response.push("  Inbound ID: " + bridgedRoom.InboundId);
        response.push("  Inbound URL: " + this.main.getInboundUrlForRoom(bridgedRoom));
        response.push("  Matrix room ID: " + bridgedRoom.MatrixRoomId);
        response.push("  Using RTM: " + (bridgedRoom.SlackTeamId ? this.main.teamIsUsingRtm(bridgedRoom.SlackTeamId) : false).toString());

        this.respond(data, response.join('\n'));
    }

    @BotCommand({ name: 'link', help: 'connect a Matrix and a Slack room together', requiredArgs: ['room', 'channel_id'], optionalArgs: ['webhook_url', 'slack_bot_token', 'team_id'] })
    public async link(data: CommandArguments<CommandContext>) {
        const _options = {
            channel_id: {
                alias: "I",
                description: "Slack channel ID",
            },
            room: RoomIdCommandOption,
            slack_bot_token: {
                alias: "t",
                description: "Slack bot user token. Used with Slack bot user & Events api",
            },
            team_id: {
                alias: "T",
                description: "Slack team ID. Used with Slack bot user & Events api",
            },
            webhook_url: {
                alias: "u",
                description: "Slack webhook URL. Used with Slack outgoing hooks integration",
            },
        };
        ///////////////////////////////////////////////////
        const [room, channel_id, ...optionals] = data.args;
        // FIXME: we need to somehow deduce which combination of arguments was actually passed
        const [webhook_url, slack_bot_token, team_id] = optionals;

        const response: string[] = [];
        try {
            const r = await this.main.actionLink({
                matrix_room_id: room,
                slack_bot_token,
                team_id,
                slack_channel_id: channel_id,
                slack_webhook_uri: webhook_url,
            });
            response.push("Room is now " + r.getStatus());
            if (r.SlackWebhookUri) {
                response.push("Inbound URL is " + this.main.getInboundUrlForRoom(r));
            } else {
                response.push("Remember to invite the slack bot to the slack channel.");
            }
        } catch (ex) {
            log.warn("Failed to link channel", ex);
            if ((ex as Error).message === "Failed to get channel info") {
                response.push("Cannot link - Bot doesn't have visibility on channel. Is it invited on slack?");
            } else {
                response.push("Cannot link - " + ex);
            }
        }

        this.respond(data, response.join('\n'));
    }

    @BotCommand({ name: 'unlink', help: 'disconnect a linked Matrix and Slack room', requiredArgs: ['room'] })
    public async unlink(data: CommandArguments<CommandContext>) {
        try {
            await this.main.actionUnlink({
                matrix_room_id: data.args[0],
            });
            this.respond(data, "Unlinked");
        } catch (ex) {
            this.respond(data, "Cannot unlink - " + ex);
        }
    }

    @BotCommand({ name: 'join', help: 'join a new room', requiredArgs: ['room'] })
    public async join(data: CommandArguments<CommandContext>) {
        await this.main.botIntent.join(data.args[0]);
        this.respond(data, "Joined");
    }

    @BotCommand({ name: 'leave', help: 'leave an unlinked room', requiredArgs: ['room'] })
    public async leave(data: CommandArguments<CommandContext>) {
        const room = data.args[0];

        const userIds = await this.main.listGhostUsers(room);
        this.respond(data, `Draining ${userIds.length} ghosts from ${room}`);
        await Promise.all(userIds.map(async (userId) => this.main.getIntent(userId).leave(room)));
        await this.main.botIntent.leave(room);
        this.respond(data, "Drained");
    }

    @BotCommand({ name: 'stalerooms', help: 'list rooms the bot user is a member of that are unlinked' })
    public async stalerooms(data: CommandArguments<CommandContext>) {
        const roomIds = await this.main.listRoomsFor();
        this.respond(data, roomIds.filter(id =>
            !(id === this.main.config.matrix_admin_room || this.main.rooms.getByMatrixRoomId(id))
        ).join("\n"));
    }

    @BotCommand({ name: 'doOauth', help: 'generate an oauth url to bind your account with', requiredArgs: ['userId'], optionalArgs: ['puppet'] })
    public async doOauth(data: CommandArguments<CommandContext>) {
        const _options = {
            userId: {
                type: "string",
                description: "The userId to bind to the oauth token",
            },
            puppet: {
                type: "boolean",
                description: "Does the user need puppeting permissions",
            },
        };
        //////////////////////////
        if (!this.main.oauth2) {
            return this.respond(data, "Oauth is not configured on this bridge");
        }
        const token = this.main.oauth2.getPreauthToken(data.args[0]);
        const authUri = this.main.oauth2.makeAuthorizeURL(
            token,
            token,
            !!data.args[1], // FIXME how to boolify it better? Check for 'true', 'yes' etc?
        );
        this.respond(data, authUri);
    }

    @BotCommand({ name: 'help', help: 'describes the commands available', optionalArgs: ['command'] })
    public async help(data: CommandArguments<CommandContext>) {
        const command = data.args[0];
        if (command) {
            const cmd = null; // FIXME this.commands.find((adminCommand) => (adminCommand.command.split(' ')[0] === command));
            if (!cmd) {
                return this.respond(data, "Command not found. No help can be provided.");
            }
            //cmd.detailedHelp().forEach((s) => this.respond(data, s));
        } else {
            this.respond(data, this.handler.helpMessage.body);
        }
    }
}
