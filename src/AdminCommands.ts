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

import { Logger } from "matrix-appservice-bridge";
import * as yargs from "yargs";
import { AdminCommand, IHandlerArgs, ResponseCallback } from "./AdminCommand";
import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";

const log = new Logger("AdminCommands");

const RoomIdCommandOption = {
    alias: "R",
    demandOption: true,
    description: "Matrix Room ID",
};

export class AdminCommands {
    private yargs: yargs.Argv;
    private commands: AdminCommand[];
    private latestCommandWaiterForSender: Map<string, Promise<void>> = new Map();
    constructor(private main: Main) {
        this.commands = [
            this.onUnmatched,
            this.list,
            this.show,
            this.link,
            this.unlink,
            this.join,
            this.leave,
            this.stalerooms,
            this.doOauth,
            this.help,
        ];

        this.yargs = yargs.parserConfiguration({})
            .version(false)
            .help(false); // We provide our own help, and version is not required.
        // NOTE: setting exitProcess() is unnecessary when parse() is provided a callback.

        this.commands.forEach((cmd) => {
            this.yargs.command<IHandlerArgs>(
                cmd.command,
                cmd.description,
                () => cmd.options ?? {},
                // NOTE: yargs documentation advises against command() returning a Promise
                // when parse() will be called multiple times, so instead resolve any
                // asynchronous operations of the callbacks elsewhere.
                (argv) => void cmd.handler(argv),
            );
        });
    }

    public get onUnmatched(): AdminCommand {
        return new AdminCommand("*", "", (args) => {
            const cmd = args._[0];
            log.debug(`Unrecognised command "${cmd}"`);
            args.respond(`Unrecognised command "${cmd}"`);
        });
    }

    public get list(): AdminCommand {
        return new AdminCommand(
            "list",
            "list the linked rooms",
            async ({respond, team, room}: {
                respond: ResponseCallback,
                team?: string,
                room?: string,
            }) => {
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
                    respond(`${status} ${slack} -- ${r.MatrixRoomId}`);
                });

                if (!found) {
                    respond("No rooms found");
                }
            },
            {
                room: {
                    alias: "R",
                    description: "Filter only Matrix room IDs containing this string fragment",
                },
                team: {
                    alias: "T",
                    description: "Filter only rooms for this Slack team domain",
                },
            },
        );
    }

    public get show(): AdminCommand {
        return new AdminCommand(
            "show",
            "show a single connected room",
            ({respond, channel_id, room}: {
                respond: ResponseCallback,
                channel_id?: string,
                room?: string
            }) => {
                let bridgedRoom: BridgedRoom|undefined;
                if (room) {
                    bridgedRoom = this.main.rooms.getByMatrixRoomId(room);
                } else if (channel_id) {
                    bridgedRoom = this.main.rooms.getBySlackChannelId(channel_id);
                } else {
                    respond("Require exactly one of room or channel_id");
                    return;
                }

                if (!bridgedRoom) {
                    respond("No such room");
                    return;
                }

                respond("Bridged Room:");
                respond("  Status: " + bridgedRoom.getStatus());
                respond("  Slack Name: " + bridgedRoom.SlackChannelName || "PENDING");
                respond("  Slack Team: " + bridgedRoom.SlackTeamId || "PENDING");
                if (bridgedRoom.SlackWebhookUri) {
                    respond("  Webhook URI: " + bridgedRoom.SlackWebhookUri);
                }
                respond("  Inbound ID: " + bridgedRoom.InboundId);
                respond("  Inbound URL: " + this.main.getInboundUrlForRoom(bridgedRoom));
                respond("  Matrix room ID: " + bridgedRoom.MatrixRoomId);
                respond("  Using RTM: " + (bridgedRoom.SlackTeamId ? this.main.teamIsUsingRtm(bridgedRoom.SlackTeamId) : false).toString());
            },
            {
                channel_id: {
                    alias: "I",
                    description: "Slack channel ID",
                },
                room: { ...RoomIdCommandOption, demandOption: false },
            },
        );
    }

    public get link(): AdminCommand {
        return new AdminCommand(
            "link",
            "connect a Matrix and a Slack room together",
            async ({respond, room, channel_id, webhook_url, slack_bot_token, team_id}: {
                respond: ResponseCallback,
                room?: string,
                channel_id?: string,
                webhook_url?: string,
                slack_bot_token?: string,
                team_id?: string,
            }) => {
                try {
                    if (!room) {
                        respond("Room not provided");
                        return;
                    }
                    const r = await this.main.actionLink({
                        matrix_room_id: room,
                        slack_bot_token,
                        team_id,
                        slack_channel_id: channel_id,
                        slack_webhook_uri: webhook_url,
                    });
                    respond("Room is now " + r.getStatus());
                    if (r.SlackWebhookUri) {
                        respond("Inbound URL is " + this.main.getInboundUrlForRoom(r));
                    } else {
                        respond("Remember to invite the slack bot to the slack channel.");
                    }
                } catch (ex) {
                    log.warn("Failed to link channel", ex);
                    if ((ex as Error).message === "Failed to get channel info") {
                        respond("Cannot link - Bot doesn't have visibility on channel. Is it invited on slack?");
                    } else {
                        respond("Cannot link - " + ex);
                    }
                }
            },
            {
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
            },
        );
    }

    public get unlink(): AdminCommand {
        return new AdminCommand(
            "unlink",
            "disconnect a linked Matrix and Slack room",
            async ({respond, room}: {
                respond: ResponseCallback,
                room?: string,
            }) => {
                if (!room) {
                    respond("Room not provided");
                    return;
                }
                try {
                    await this.main.actionUnlink({
                        matrix_room_id: room,
                    });
                    respond("Unlinked");
                } catch (ex) {
                    respond("Cannot unlink - " + ex);
                }
            },
            {
                room: RoomIdCommandOption,
            },
        );
    }

    public get join(): AdminCommand {
        return new AdminCommand(
            "join room",
            "join a new room",
            async ({respond, room}: {
                respond: ResponseCallback,
                room?: string,
            }) => {
                if (!room) {
                    respond("No room provided");
                    return;
                }
                await this.main.botIntent.join(room);
                respond("Joined");
            },
            {
                room: RoomIdCommandOption,
            },
        );
    }

    public get leave(): AdminCommand {
        return new AdminCommand(
            "leave room",
            "leave an unlinked room",
            async ({respond, room}: {
                respond: ResponseCallback,
                room?: string,
            }) => {
                if (!room) {
                    respond("Room not provided");
                    return;
                }
                const userIds = await this.main.listGhostUsers(room);
                respond(`Draining ${userIds.length} ghosts from ${room}`);
                await Promise.all(userIds.map(async (userId) => this.main.getIntent(userId).leave(room)));
                await this.main.botIntent.leave(room);
                respond("Drained");
            },
            {
                room: RoomIdCommandOption,
            },
        );
    }

    public get stalerooms(): AdminCommand {
        return new AdminCommand(
            "stalerooms",
            "list rooms the bot user is a member of that are unlinked",
            async ({respond}: { respond: ResponseCallback }) => {
                const roomIds = await this.main.listRoomsFor();
                roomIds.forEach((id) => {
                    if (id === this.main.config.matrix_admin_room ||
                        this.main.rooms.getByMatrixRoomId(id)) {
                        return;
                    }
                    respond(id);
                });
            },
        );
    }

    public get doOauth(): AdminCommand {
        return new AdminCommand(
            "oauth userId puppet",
            "generate an oauth url to bind your account with",
            async ({respond, userId, puppet}: {
                respond: ResponseCallback,
                userId?: string,
                puppet?: boolean,
            }) => {
                if (!this.main.oauth2) {
                    respond("Oauth is not configured on this bridge");
                    return;
                }
                if (!userId) {
                    respond("userId not provided");
                    return;
                }
                const token = this.main.oauth2.getPreauthToken(userId);
                const authUri = this.main.oauth2.makeAuthorizeURL(
                    token,
                    token,
                    puppet,
                );
                respond(authUri);
            },
            {
                userId: {
                    type: "string",
                    description: "The userId to bind to the oauth token",
                },
                puppet: {
                    type: "boolean",
                    description: "Does the user need puppeting permissions",
                },
            },
        );
    }

    public get help(): AdminCommand {
        return new AdminCommand(
            "help [command]",
            "describes the commands available",
            ({respond, command}: {
                respond: ResponseCallback,
                command?: string,
            }) => {
                if (command) {
                    const cmd = this.commands.find((adminCommand) => (adminCommand.command.split(' ')[0] === command));
                    const help = cmd?.detailedHelp();
                    if (!help) {
                        respond("Command not found. No help can be provided.");
                    } else {
                        help.forEach((s) => respond(s));
                    }
                    return;
                }
                this.commands.forEach((cmd) => {
                    const help = cmd.simpleHelp();
                    if (help) {
                        respond(help);
                    }
                });
            },
            {
                command: {
                    description: "Get help about a particular command",
                },
            },
        );
    }

    /**
     * Queue a command to be parsed & executed.
     * NOTE: Callers should await not on a call of this function, but on its return value.
     * Doing so ensures that commands will be queued in the order in which they're issued.
     */
    public async parse(argv: string, respond: ResponseCallback, sender: string): Promise<void> {
        const currCommandWaiter = new Promise<void>(resolve => {
            const prevCommandWaiter = this.latestCommandWaiterForSender.get(sender) ?? Promise.resolve();
            void prevCommandWaiter.then(() => {
                this.yargs.parseSync(argv, {
                    respond,
                }, (error) => {
                    if (error) {
                        // NOTE: Throwing here makes yargs.argv get "stuck" on an error object, so just handle the error now
                        log.warn(`Command '${argv}' failed to complete:`, {message: error.message, name: error.name});
                        // YErrors are yargs errors when the user inputs the command wrong.
                        respond(`${error.name === "YError" ? error.message : "Command failed: See the logs for details."}`);
                    }
                });
            }).finally(resolve);
        });
        this.latestCommandWaiterForSender.set(sender, currCommandWaiter);
        return currCommandWaiter;
    }
}
