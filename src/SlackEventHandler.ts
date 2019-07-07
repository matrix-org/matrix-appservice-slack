import { BaseSlackHandler, ISlackFile } from "./BaseSlackHandler";
import { BridgedRoom } from "./BridgedRoom";
import { ServerResponse } from "http";
import { Main } from "./Main";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("SlackEventHandler");

interface ISlackEventParams {
    team_id: string;
    event: ISlackEventEvent;
    name: string;
    type: string;
}

interface ISlackEventEvent {
    type: string;
    channel: string;
    domain: string|undefined;
}

interface ISlackEventParamsVerification extends ISlackEventParams {
    type: "url_verification";
    challenge: string;
}

interface ISlackEventParamsMessage extends ISlackEventParams {
    event: ISlackEventMessageEvent;
}

interface ISlackEventMessageAttachment {
    fallback: string;
}

interface ISlackEventMessageEvent extends ISlackEventEvent {
    subtype: string;
    user?: string;
    bot_id?: string;
    text?: string;
    deleted_ts: number;
    // For comments
    comment?: {
        user: string;
    };
    attachments?: ISlackEventMessageAttachment[];
    // For message_changed
    message?: {
        text: string;
        user: string;
        bot_id: string;
    };
    previous_message?: {
        text: string;
    };
    file?: ISlackFile;
}

const HTTP_OK = 200;

export class SlackEventHandler extends BaseSlackHandler {
    constructor(main: Main) {
        super(main);
    }

    /**
     * Handles a slack event request.
     */
    public async handle(params: ISlackEventParams, response: ServerResponse) {
        try {
            log.debug("Received slack event:", params);

            const endTimer = this.main.startTimer("remote_request_seconds");

            // respond to event url challenges
            if (params.type === "url_verification") {
                const challengeParams = params as ISlackEventParamsVerification;
                response.writeHead(HTTP_OK, {"Content-Type": "application/json"});
                response.write(JSON.stringify({challenge: challengeParams.challenge}));
                response.end();
                return;
            } else {
                // See https://api.slack.com/events-api#responding_to_events
                // We must respond within 3 seconds or it will be sent again!
                response.writeHead(HTTP_OK, "OK");
                response.end();
            }

            let err: string|null = null;
            try {
                switch (params.event.type) {
                    case "message":
                    case "reaction_added":
                    case "reaction_removed":
                        await this.handleMessageEvent(params as ISlackEventParamsMessage);
                        break;
                    case "channel_rename":
                        await this.handleChannelRenameEvent(params);
                        break;
                    case "team_domain_change":
                        await this.handleDomainChangeEvent(params);
                        break;
                    // XXX: Unused?
                    case "file_comment_added":
                    default:
                        err = "unknown_event";
                }
            } catch (ex) {
                err = ex;
            }

            if (err === "unknown_channel") {
                const chanIdMix = `${params.event.channel} (${params.team_id})`;
                log.warn(`Ignoring message from unrecognised slack channel id: ${chanIdMix}`);
                this.main.incCounter("received_messages", {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err === "unknown_event") {
                endTimer({outcome: "dropped"});
            } else if (err !== null) {
                endTimer({outcome: "fail"});
            }

            if (err === null) {
                endTimer({outcome: "success"});
            } else {
                log.error("Failed to handle slack event:", err);
            }
        } catch (e) {
            log.error("SlackEventHandler.handle failed:", e);
        }
    }

    private async handleDomainChangeEvent(params: ISlackEventParams) {
        this.main.getRoomsBySlackTeamId(params.team_id).forEach((room: BridgedRoom) => {
            room.SlackTeamDomain = params.event.domain!;
            if (room.isDirty) {
                this.main.putRoomToStore(room);
            }
        });
    }

    private async handleChannelRenameEvent(params: ISlackEventParams) {
        // TODO test me. and do we even need this? doesn't appear to be used anymore
        const room = this.main.getRoomBySlackChannelId(params.event.channel);
        if (!room) { throw new Error("unknown_channel"); }

        const channelName = `${room.SlackTeamDomain}.#${params.name}`;
        room.SlackChannelName = channelName;
        if (room.isDirty) {
            this.main.putRoomToStore(room);
        }
    }

    /**
     * Attempts to handle the `message` event.
     *
     * Sends a message to Matrix if it understands enough of the message to do so.
     * Attempts to make the message as native-matrix feeling as it can.
     */
    private async handleMessageEvent(params: ISlackEventParamsMessage) {
        const room = this.main.getRoomBySlackChannelId(params.event.channel) as BridgedRoom;
        if (!room) { throw new Error("unknown_channel"); }

        if (params.event.subtype === "bot_message" &&
            (!room.SlackBotId || params.event.bot_id === room.SlackBotId)) {
            return;
        }

        // Only count received messages that aren't self-reflections
        this.main.incCounter("received_messages", {side: "remote"});

        const token = room.AccessToken;

        const msg = Object.assign({}, params.event, {
            channel_id: params.event.channel,
            team_domain: room.SlackTeamDomain || room.SlackTeamId,
            team_id: params.team_id,
            user_id: params.event.user || params.event.bot_id,
        });

        if (params.event.type === "reaction_added") {
            return room.onSlackReactionAdded(msg);
        }  // TODO: We cannot remove reactions yet, see #154
        /* else if (params.event.type === "reaction_removed") {
            return room.onSlackReactionRemoved(msg);
        } */

        if (!token) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + room.SlackTeamDomain || room.SlackChannelId);
            return room.onSlackMessage(msg);
        }

        // Handle events with attachments like bot messages.
        if (params.event.type === "message" && params.event.attachments) {
            for (const attachment of params.event.attachments) {
                msg.text = attachment.fallback;
                msg.text = await this.doChannelUserReplacements(msg, msg.text!, token);
                return await room.onSlackMessage(msg);
            }
            if (params.event.text === "") {
                return;
            }
            msg.text = params.event.text;
        }

        // In this method we must standardise the message object so that
        // getGhostForSlackMessage works correctly.
        if (msg.subtype === "file_comment" && msg.comment) {
            msg.user_id = msg.comment.user;
        } else if (msg.subtype === "message_changed" && msg.message && msg.previous_message) {
            msg.user_id = msg.message.user;
            msg.text = msg.message.text;
            msg.previous_message.text = (await this.doChannelUserReplacements(msg, msg.previous_message.text, token))!;

            // Check if the edit was sent by a bot
            if (msg.message.bot_id !== undefined) {
                // Check the edit wasn't sent by us
                if (msg.message.bot_id === room.SlackBotId) {
                    return;
                } else {
                    msg.user_id = msg.bot_id;
                }
            }
        } else if (msg.subtype === "message_deleted") {
            const store = this.main.eventStore;
            const originalEvent = await store.getEntryByRemoteId(msg.channel, msg.deleted_ts);
            const botClient = this.main.botIntent.getClient();
            return botClient.redactEvent(originalEvent.roomId, originalEvent.eventId);
        }

        if (!token) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + room.SlackTeamDomain || room.SlackChannelId);
            return room.onSlackMessage(msg);
        }

        if (msg.subtype === "file_share" && msg.file) {
            // we need a user token to be able to enablePublicSharing
            if (room.SlackUserToken) {
                // TODO check is_public when matrix supports authenticated media
                // https://github.com/matrix-org/matrix-doc/issues/701
                const file = await this.enablePublicSharing(msg.file, room.SlackUserToken);
                if (file) {
                    msg.file = file;
                    msg.file!._content = await this.fetchFileContent(msg.file!);
                }
            }
        }

        msg.text = await this.doChannelUserReplacements(msg, msg.text!, token);
        return room.onSlackMessage(msg);
    }
}
