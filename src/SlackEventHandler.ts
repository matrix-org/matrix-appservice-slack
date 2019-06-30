import { BaseSlackHandler } from "./BaseSlackHandler";
import { BridgedRoom } from "./BridgedRoom";
import { on } from "cluster";
import { ServerResponse } from "http";

const Promise = require('bluebird');
const log = require("matrix-appservice-bridge").Logging.get("SlackEventHandler");

interface ISlackEventParams {
    team_id: string;
    event: ISlackEventEvent,
    name: string;
    type: string;
}

interface ISlackEventEvent {
    type: string;
    channel: {
        id: string;
    };
    domain: string|undefined;
}

interface ISlackEventParamsVerification extends ISlackEventParams {
    type: "url_verification"
    challenge: string;
}

interface ISlackEventParamsMessage extends ISlackEventParams {
    event: ISlackEventMessageEvent
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
    },
    // For message_changed
    message?: {
        text: string;
        user: string;
        bot_id: string;
    },
    file?: {
        _content: Buffer,
    },
}


export class SlackEventHandler extends BaseSlackHandler {
    constructor(main: any) {
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
            if (params.type === 'url_verification') {
                const challengeParams = params as ISlackEventParamsVerification;
                response.writeHead(200, {"Content-Type": "application/json"});
                response.write(JSON.stringify({challenge: challengeParams.challenge}));
                response.end();
                return;
            }
    
            let result = null;
            let err = null;
            try {
                switch (params.event.type) {
                    case 'message':
                        result = await this.handleMessageEvent(params as ISlackEventParamsMessage);
                        break;
                    case 'channel_rename':
                        result = await this.handleChannelRenameEvent(params);
                        break;
                    case 'team_domain_change':
                        result = await this.handleDomainChangeEvent(params);
                        break;
                    case 'file_comment_added':
                        result = undefined;
                        break;
                    default:
                        err = "unknown_event"
                }
            } catch (ex) {
                err = ex;
            }

            if (err === "unknown_channel") {
                log.warn("Ignoring message from unrecognised slack channel id : %s (%s)",
                    params.event.channel.id, params.team_id);
                this.main.incCounter("received_messages", {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err === "unknown_event") {
                endTimer({outcome: "dropped"});
            } else if (err !== null) {
                endTimer({outcome: "fail"});
            }

            if (err !== null) {
                log.error("Failed to handle slack event");
            }

            if (result !== null) {
                endTimer({outcome: "success"});
            }

        } catch (e) {
            log.error("SlackEventHandler.handle failed:", e);
        }
    
        // return 200 so slack doesn't keep sending the event
        response.writeHead(200, {"Content-Type": "text/plain"});
        response.end();
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
        //TODO test me. and do we even need this? doesn't appear to be used anymore
        const room = this.main.getRoomBySlackChannelId(params.event.channel.id);
        if (!room) throw "unknown_channel";

        var channelName = `${room.SlackTeamDomain}.#${params.name}`;
        room.SlackChannelName = channelName;
        if (room.isDirty()) {
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
        const room = this.main.getRoomBySlackChannelId(params.event.channel.id) as BridgedRoom;
        if (!room) throw "unknown_channel";

        if (params.event.subtype === 'bot_message' &&
            (!room.SlackBotId || params.event.bot_id === room.SlackBotId)) {
            return;
        }

        // Only count received messages that aren't self-reflections
        this.main.incCounter("received_messages", {side: "remote"});

        const token = room.AccessToken;

        var msg = Object.assign({}, params.event, {
            user_id: params.event.user || params.event.bot_id,
            team_domain: room.SlackTeamDomain || room.SlackTeamId,
            team_id: params.team_id,
            channel_id: params.event.channel
        });

        // In this method we must standardise the message object so that
        // getGhostForSlackMessage works correctly.
        if (msg.subtype === 'file_comment' && msg.comment) {
            msg.user_id = msg.comment.user;
        }
        else if (msg.subtype === "message_changed" && msg.message) {
            msg.user_id = msg.message.user;
            msg.text = msg.message.text;

            // Check if the edit was sent by a bot
            if (msg.message.bot_id !== undefined) {
                // Check the edit wasn't sent by us
                if (msg.message.bot_id === room.SlackBotId) {
                    return Promise.resolve();
                }
                else {
                    msg.user_id = msg.bot_id;
                }
            }
        }
        // We must handle message deleted here because it is not done as the ghost
        // user but as the AS user. (There is no user_id in the message event from
        // which to create a ghost.)
        else if (msg.subtype === "message_deleted") {
            const store = this.main.getEventStore();
            const originalEvent = await store.getEntryByRemoteId(msg.channel, msg.deleted_ts);
            const botClient = this.main.getBotIntent().getClient();
            return botClient.redactEvent(originalEvent.roomId, originalEvent.eventId);
        }

        if (!token) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + room.SlackTeamDomain || room.SlackChannelId);
            return room.onSlackMessage(msg);
        }

        let result;
        if (msg.subtype === "file_share" && msg.file) {
            // we need a user token to be able to enablePublicSharing
            if (room.SlackUserToken) {
                // TODO check is_public when matrix supports authenticated media
                // https://github.com/matrix-org/matrix-doc/issues/701
                result = this.enablePublicSharing(msg.file, room.SlackUserToken)
                    .then((file: any) => {
                        if (file) {
                            msg.file = file;
                        }

                        return this.fetchFileContent(msg.file, token)
                            .then((content) => {
                                msg.file!._content = content;
                            });
                    });
            }
        } else {
            result = Promise.resolve();
        }

        let newMsg = await this.replaceChannelIdsWithNames((await result), token);
        newMsg = await this.replaceUserIdsWithNames(newMsg, token);
        newMsg = await room.onSlackMessage(newMsg);
        return newMsg;
    }
}