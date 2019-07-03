import { Logging } from "matrix-appservice-bridge";
import { AdminCommand, ResponseCallback } from "./AdminCommand";
import * as yargs from "yargs";
import { Main } from "./Main";
import { BridgedRoom } from "./BridgedRoom";

const log = Logging.get("AdminCommands");

const RoomIdDef = {
    alias: "R",
    demandOption: true,
    description: "Matrix Room Id",
};

export class AdminCommands {
    private yargs: yargs.Argv;
    constructor(private main: Main) {
        this.yargs = yargs.parserConfiguration({

        });
        [
            this.list,
            this.show,
            this.link,
            this.unlink,
            this.join,
            this.leave,
            this.stalerooms,
            this.help,
        ].forEach((cmd) => {
            this.yargs = this.yargs.command(cmd).options(cmd.options);
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

                    if (room && r.MatrixRoomId.includes(room as string)) {
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
                respond("  Inbound URL: " + this.main.getInboundUrlForRoom(room));
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
                        respond("Inbound URL is " + this.main.getInboundUrlForRoom(room));
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
            "unlink",
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
                roomId: RoomIdDef,
            },
        );
    }

    public get join() {
        return new AdminCommand(
            "leave roomId",
            "join a new room",
            async ({room, respond}) => {
                await this.main.botIntent.join(room);
                respond("Joined");
            },
            {
                roomId: RoomIdDef,
            },
        );
    }

    public get leave() {
        return new AdminCommand(
            "leave roomId",
            "leave an unlinked room",
            async ({room, respond}) => {
                const roomId: string = room as string;

                const userIds = await this.main.listGhostUsers(roomId);
                respond(`Draining ${userIds.length} ghosts from ${roomId}`);
                Promise.all(userIds.map((userId) => {
                    return this.main.getIntent(userId).leave(roomId);
                }));
                await this.main.botIntent.leave(roomId);
                respond("Drained");
            },
            {
                roomId: RoomIdDef,
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
            "help",
            "describes the commands available",
            () => {
                // TODO: This
            },
        );
    }

    public parse(argv: string, respond: ResponseCallback) {
        this.yargs.parse(argv, {
            respond,
        });
    }
}
