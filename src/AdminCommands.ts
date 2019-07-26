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
import * as yargs from "yargs";
import { AdminCommand, ResponseCallback } from "./AdminCommand";
import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";

const log = Logging.get("AdminCommands");

const RoomIdDef = {
    alias: "R",
    demandOption: true,
    description: "Matrix Room ID",
};

export class AdminCommands {
    private yargs: yargs.Argv;
    private commands = [
            this.list,
            this.show,
            this.link,
            this.unlink,
            this.join,
            this.leave,
            this.stalerooms,
            this.help,
    ];
    constructor(private main: Main) {
        this.yargs = yargs.parserConfiguration({

        }).version(false).help(false); // We provide our own help, and version is not required.
        this.commands.forEach((cmd) => {
            this.yargs = this.yargs.command(cmd.command, cmd.description, ((yg) => {
                if (cmd.options) {
                    return yg.options(cmd.options);
                }
            // TODO: Fix typing
            // tslint:disable-next-line: no-any
            }) as any, cmd.handler.bind(cmd));
        });
    }

    public get list() {
        return new AdminCommand(
            "list",
            "list the linked rooms",
            async ({respond, team, room}) => {
                const quotemeta = (s: string) => s.replace(/\W/g, "\\$&");
                let nameFilter: RegExp;

                if (team) {
                    nameFilter = new RegExp(`^${quotemeta(team as string)}\.#`);
                }

                let found = 0;
                this.main.allRooms.forEach((r) => {
                    const channelName = r.SlackChannelName || "UNKNOWN";

                    if (nameFilter && !nameFilter.exec(channelName)) {
                        return;
                    }

                    if (room && !r.MatrixRoomId.includes(room as string)) {
                        return;
                    }

                    const slack = r.SlackChannelId ?
                        `${channelName} (${r.SlackChannelId})` :
                        channelName;

                    let status = r.getStatus();
                    if (!status.match(/^ready/)) {
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

    public get show() {
        return new AdminCommand(
            "show",
            "show a single connected room",
            ({respond, channel, channel_id, room}) => {
                let bridgedRoom: BridgedRoom|undefined;
                if (typeof(room) === "string") {
                    bridgedRoom = this.main.getRoomByMatrixRoomId(room);
                } else if (typeof(channel) === "string") {
                    bridgedRoom = this.main.getRoomBySlackChannelName(channel) || undefined;
                } else if (typeof(channel_id) === "string") {
                    bridgedRoom = this.main.getRoomBySlackChannelId(channel_id);
                } else {
                    respond("Require exactly one of room, channel or channel_id");
                    return;
                }

                if (!bridgedRoom) {
                    respond("No such room");
                    return;
                }

                respond("Bridged Room:");
                respond("  Status: " + bridgedRoom.getStatus());
                respond("  Slack Name: " + bridgedRoom.SlackChannelName || "PENDING");
                respond("  Webhook URI: " + bridgedRoom.SlackWebhookUri);
                respond("  Inbound ID: " + bridgedRoom.InboundId);
                respond("  Inbound URL: " + this.main.getInboundUrlForRoom(bridgedRoom));
                respond("  Matrix room ID: " + bridgedRoom.MatrixRoomId);

                if (this.main.oauth2) {
                    const authUrl = this.main.oauth2.makeAuthorizeURL(
                        bridgedRoom,
                        bridgedRoom.InboundId,
                    );
                    respond("  OAuth2 authorize URL: " + authUrl);
                }
            },
            {
                channel: {
                    alias: "C",
                    description: "Slack channel name",
                },
                channel_id: {
                    alias: "I",
                    description: "Slack channel ID",
                },
                room: {
                    alias: "R",
                    description: "Matrix room ID",
                },
            },
        );
    }

    public get link() {
        return new AdminCommand(
            "link",
            "connect a Matrix and a Slack room together",
            async ({respond, room, channel_id, webhook_url, slack_bot_token, slack_user_token}) => {
                try {
                    const r = await this.main.actionLink({
                        matrix_room_id: room as string,
                        slack_bot_token: slack_bot_token as string,
                        slack_channel_id: channel_id as string,
                        slack_user_token: slack_user_token as string,
                        slack_webhook_uri: webhook_url as string,
                    });
                    respond("Room is now " + r.getStatus());
                    if (r.SlackWebhookUri) {
                        respond("Inbound URL is " + this.main.getInboundUrlForRoom(r));
                    }
                } catch (ex) {
                    respond("Cannot link - " + ex );
                }
            },
            {
                channel_id: {
                    alias: "I",
                    description: "Slack channel ID",
                },
                room: RoomIdDef,
                slack_bot_token: {
                    alias: "t",
                    description: "Slack bot user token. Used with Slack bot user & Events api",
                },
                slack_user_token: {
                    description: "Slack user token. Used to bridge files",
                },
                webhook_url: {
                    alias: "u",
                    description: "Slack webhook URL. Used with Slack outgoing hooks integration",
                },
            },
        );
    }

    public get unlink() {
        return new AdminCommand(
            "unlink room",
            "disconnect a linked Matrix and Slack room",
            async ({room, respond}) => {
                try {
                    await this.main.actionUnlink({
                        matrix_room_id: room as string,
                        // slack_channel_name: channel,
                        // slack_channel_id: channel_id,
                    });
                    respond("Unlinked");
                } catch (ex) {
                    respond("Cannot unlink - " + ex);
                }
            },
            {
                room: RoomIdDef,
            },
        );
    }

    public get join() {
        return new AdminCommand(
            "join room",
            "join a new room",
            async ({room, respond}) => {
                await this.main.botIntent.join(room);
                respond("Joined");
            },
            {
                room: RoomIdDef,
            },
        );
    }

    public get leave() {
        return new AdminCommand(
            "leave room",
            "leave an unlinked room",
            async ({room, respond}) => {
                const roomId: string = room as string;
                const userIds = await this.main.listGhostUsers(roomId);
                respond(`Draining ${userIds.length} ghosts from ${roomId}`);
                await Promise.all(userIds.map((userId) => {
                    return this.main.getIntent(userId).leave(roomId);
                }));
                await this.main.botIntent.leave(roomId);
                respond("Drained");
            },
            {
                room: RoomIdDef,
            },
        );
    }

    public get stalerooms() {
        return new AdminCommand(
            "stalerooms",
            "list rooms the bot user is a member of that are unlinked",
            async ({respond}) => {
                const roomIds = await this.main.listRoomsFor();
                roomIds.forEach((id) => {
                    if (id === this.main.config.matrix_admin_room ||
                        this.main.getRoomByMatrixRoomId(id)) {
                        return;
                    }
                    respond(id);
                });
            },
        );
    }

    public get help() {
        return new AdminCommand(
            "help [command]",
            "describes the commands available",
            ({respond, command}) => {
                if (command) {
                    const cmd = this[command as string] as AdminCommand;
                    if (!cmd) {
                        respond("Command not found. No help can be provided.");
                        return;
                    }
                    cmd.detailedHelp().forEach((s) => respond(s));
                    return;
                }
                this.commands.forEach((cmd) => {
                    respond(cmd.simpleHelp());
                });
            },
            {
                command: {
                    demandOption: false,
                    description: "Get help about a particular command",
                },
            },
        );
    }

    public async parse(argv: string, respond: ResponseCallback): Promise<boolean> {
        // yargs has no way to tell us if a command matched, so we have this
        // slightly whacky function to manage it.
        return new Promise((resolve, reject) => {
            try {
                let matched = false;
                this.yargs.parse(argv, {
                    completed: (err) => { err ? reject(err) : resolve(true); },
                    matched: () => { matched = true; },
                    respond,
                }, (err) => {  if (err !== null) { reject(err); } });
                if (!matched) {
                    log.debug("No match");
                    resolve(false);
                }
            } catch (ex) {
                reject(ex);
            }
        });
    }
}
