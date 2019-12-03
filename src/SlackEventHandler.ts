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

import { BaseSlackHandler, ISlackEvent, ISlackMessageEvent, ISlackMessage, ISlackUser } from "./BaseSlackHandler";
import { BridgedRoom } from "./BridgedRoom";
import { Main } from "./Main";
import { Logging } from "matrix-appservice-bridge";
const log = Logging.get("SlackEventHandler");

interface ISlackEventChannelRenamed extends ISlackEvent {
    // https://api.slack.com/events/channel_rename
    id: string;
    name: string;
    created: number;
}

interface ISlackEventTeamDomainChanged extends ISlackEvent {
    url: string;
    domain: string;
}

interface ISlackEventReaction extends ISlackEvent {
    // https://api.slack.com/events/reaction_added
    reaction: string;
    item: ISlackMessage;
}

interface ISlackChannelAdded {
    type: string;
    channel: {
        id: string;
        name: string;
        created: number;
        creator: string;
    };
}

const HTTP_OK = 200;

export type EventHandlerCallback = (status: number, body?: string, headers?: {[header: string]: string}) => void;

export class SlackEventHandler extends BaseSlackHandler {
    /**
     * SUPPORTED_EVENTS corresponds to the types of events
     * handled in `handle`. This is useful if you need to subscribe
     * to events in order to handle them.
     */
    protected static SUPPORTED_EVENTS: string[] = ["message", "reaction_added", "reaction_removed",
    "team_domain_change", "channel_rename", "user_typing"];
    constructor(main: Main) {
        super(main);
    }

    public onVerifyUrl(challenge: string, response: EventHandlerCallback) {
        response(
            HTTP_OK,
            JSON.stringify({challenge}),
            {"Content-Type": "application/json"},
        );
    }

    /**
     * Handles a slack event request.
     * @param ISlackEventParams
     */
    public async handle(event: ISlackEvent, teamId: string, response: EventHandlerCallback, isEventAndUsingRtm: boolean) {
        try {
            // See https://api.slack.com/events-api#responding_to_events
            // We must respond within 3 seconds or it will be sent again!
            response(HTTP_OK, "OK");

            if (isEventAndUsingRtm) {
                // This is a special flag that is raised if the team is using the RTM
                // API AND this event is from the Events API. Certain Events only come down
                // that API, and we may have to handle those in the future. For now, all the events
                // given below can be found on both APIs.
                // If this flag is true, we should return early to avoid duplication.
                return;
            }
            log.debug("Received slack event:", event, teamId);
            const endTimer = this.main.startTimer("remote_request_seconds");

            let err: Error|null = null;
            try {
                switch (event.type) {
                    case "message":
                        await this.handleMessageEvent(event as ISlackMessageEvent, teamId);
                        break;
                    case "reaction_added":
                    case "reaction_removed":
                        await this.handleReaction(event as ISlackEventReaction, teamId);
                        break;
                    case "channel_rename":
                        await this.handleChannelRenameEvent(event as ISlackEventChannelRenamed);
                        break;
                    case "team_domain_change":
                        await this.handleDomainChangeEvent(event as ISlackEventTeamDomainChanged, teamId);
                        break;
                    case "user_typing":
                        await this.handleTyping(event, teamId);
                        break;
                    case "channel_created":
                    case "channel_deleted":
                    case "user_change":
                    case "team_join":
                        await this.handleTeamSyncEvent(event, teamId);
                        break;
                    // XXX: Unused?
                    case "file_comment_added":
                    default:
                        err = Error("unknown_event");
                }
            } catch (ex) {
                log.warn("Didn't handle event");
                err = ex;
            }

            if (err === null) {
                endTimer({outcome: "success"});
            } else if (!(err instanceof Error)) {
                log.warn("Error when handing event:", err);
                endTimer({outcome: "fail"});
            } else if (err.message === "unknown_channel") {
                const chanIdMix = `${event.channel} (${teamId})`;
                log.warn(`Ignoring message from unrecognised slack channel id: ${chanIdMix}`);
                this.main.incCounter("received_messages", {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_team") {
                log.warn(`Ignoring message from unrecognised slack team id: ${teamId}`);
                this.main.incCounter("received_messages", {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_message") {
                log.warn(`Ignoring event because we couldn't find a referred to message`);
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_event" || err.message === "ignored") {
                // where ignored means we deliberately don't care about an event.
                endTimer({outcome: "dropped"});
            } else {
                log.warn("Error when handing event:", err);
                endTimer({outcome: "fail"});
            }
        } catch (e) {
            log.error("SlackEventHandler.handle failed:", e);
        }
    }

    /**
     * Attempts to handle the `message` event.
     *
     * Sends a message to Matrix if it understands enough of the message to do so.
     * Attempts to make the message as native-matrix feeling as it can.
     * @param ISlackEventParamsMessage The slack message event to handle.
     */
    protected async handleMessageEvent(event: ISlackMessageEvent, teamId: string) {
        const room = this.main.rooms.getBySlackChannelId(event.channel) as BridgedRoom;
        const team = await this.main.datastore.getTeam(teamId);
        if (!room) { throw Error("unknown_channel"); }
        if (!team) { throw Error("unknown_team"); }

        if (event.bot_id && (event.bot_id === team.bot_id)) {
            return;
        }

        if (event.subtype !== "message_deleted" && event.message && event.message.subtype === "tombstone") {
            // Filter out tombstones early, we only care about them on deletion.
            throw Error("ignored");
        }
        // Only count received messages that aren't self-reflections
        this.main.incCounter("received_messages", {side: "remote"});

        const msg = Object.assign({}, event, {
            channel_id: event.channel,
            team_domain: team.domain || team.id,
            team_id: teamId,
            user_id: event.user || event.bot_id,
        });

        if (event.type === "reaction_added") {
            return room.onSlackReactionAdded(msg, teamId);
        }
        // TODO: We cannot remove reactions yet, see https://github.com/matrix-org/matrix-appservice-slack/issues/154
        /* else if (params.event.type === "reaction_removed") {
            return room.onSlackReactionRemoved(msg);
        } */

        if (!room.SlackClient) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + room.SlackChannelId);
            return room.onSlackMessage(msg);
        }

        // Handle events with attachments like bot messages.
        if (msg.type === "message" && msg.attachments) {
            for (const attachment of msg.attachments) {
                msg.text = attachment.fallback;
                msg.text = await this.doChannelUserReplacements(msg, msg.text!, room.SlackClient);
                return await room.onSlackMessage(msg);
            }
            if (msg.text === "") {
                return;
            }
            msg.text = msg.text;
        }

        // In this method we must standardise the message object so that
        // getGhostForSlackMessage works correctly.
        if (msg.subtype === "file_comment" && msg.comment) {
            msg.user_id = msg.comment.user;
        } else if (msg.subtype === "message_changed" && msg.message && msg.previous_message) {
            msg.user_id = msg.message.user;
            msg.text = msg.message.text;
            msg.previous_message.text = (await this.doChannelUserReplacements(
                msg, msg.previous_message!.text!, room.SlackClient)
            )!;

            // Check if the edit was sent by a bot
            if (msg.message.bot_id !== undefined) {
                // Check the edit wasn't sent by us
                if (msg.message.bot_id === team.bot_id) {
                    return;
                } else {
                    msg.user_id = msg.bot_id;
                }
            }
        } else if (msg.subtype === "message_deleted" && msg.deleted_ts) {
            const originalEvent = await this.main.datastore.getEventBySlackId(msg.channel, msg.deleted_ts);
            if (originalEvent) {
                const botClient = this.main.botIntent.getClient();
                return botClient.redactEvent(originalEvent.roomId, originalEvent.eventId);
            }
            // If we don't have the event
            throw Error("unknown_message");
        } else if (msg.subtype === "message_replied") {
            // Slack sends us one of these as well as a normal message event
            // when using RTM, so we ignore it.
            return;
        }

        if (!room.SlackClient) {
            // If we can't look up more details about the message
            // (because we don't have a master token), but it has text,
            // just send the message as text.
            log.warn("no slack token for " + team.domain || room.SlackChannelId);
            return room.onSlackMessage(event);
        }

        let content: Buffer|undefined;

        if (msg.subtype === "file_share" && msg.file) {
            // we need a user token to be able to enablePublicSharing
            if (room.SlackClient) {
                // TODO check is_public when matrix supports authenticated media
                // https://github.com/matrix-org/matrix-doc/issues/701
                try {
                    msg.file = await this.enablePublicSharing(msg.file, room.SlackClient);
                    content = await this.fetchFileContent(msg.file);
                } catch {
                    // Couldn't get a shareable URL for the file, oh well.
                }
            }
        }

        msg.text = await this.doChannelUserReplacements(msg, msg.text!, room.SlackClient);
        return room.onSlackMessage(msg, content);
    }

    private async handleReaction(event: ISlackEventReaction, teamId: string) {
        // Reactions store the channel in the item
        const channel = event.item.channel;
        const room = this.main.rooms.getBySlackChannelId(channel) as BridgedRoom;
        const team = await this.main.datastore.getTeam(teamId);
        if (!room) { throw Error("unknown_channel"); }
        if (!team) { throw Error("unknown_team"); }

        const msg = Object.assign({}, event, {
            channel_id: channel,
            team_domain: team!.domain || room.SlackTeamId,
            team_id: teamId,
            user_id: event.user || event.bot_id,
        });

        if (event.type === "reaction_added") {
            return room.onSlackReactionAdded(msg, teamId);
        }

        // TODO: We cannot remove reactions yet, see https://github.com/matrix-org/matrix-appservice-slack/issues/154
        /* else if (params.event.type === "reaction_removed") {
            return room.onSlackReactionRemoved(msg);
        } */
    }

    private async handleDomainChangeEvent(event: ISlackEventTeamDomainChanged, teamId: string) {
        const team = await this.main.datastore.getTeam(teamId);
        if (team) {
            team.domain = event.domain;
            await this.main.datastore.upsertTeam(team);
        }
    }

    private async handleChannelRenameEvent(event: ISlackEventChannelRenamed) {
        // TODO test me. and do we even need this? doesn't appear to be used anymore
        const room = this.main.rooms.getBySlackChannelId(event.id);
        if (!room) { throw new Error("unknown_channel"); }

        const channelName = `#${event.name}`;
        room.SlackChannelName = channelName;
        if (room.isDirty) {
            await this.main.datastore.upsertRoom(room);
        }
    }

    private async handleTyping(event: ISlackEvent, teamId: string) {
        const room = this.main.rooms.getBySlackChannelId(event.channel);
        const team = await this.main.datastore.getTeam(teamId);
        if (!room) { throw Error("unknown_channel"); }
        if (!team) { throw Error("unknown_team"); }
        const typingEvent = Object.assign({}, event, {
            channel_id: event.channel,
            team_domain: team!.domain || room.SlackTeamId,
            team_id: teamId,
            user_id: event.user || event.bot_id,
        });
        await room.onSlackTyping(typingEvent, teamId);
    }

    private async handleTeamSyncEvent(event: ISlackEvent, teamId: string) {
        if (!this.main.teamSyncer) {
            throw Error("ignored");
        }
        if (event.type === "channel_created") {
            // Note: Slack violates the usual stringness of 'channel' here.
            const eventDetails = event as unknown as ISlackChannelAdded;
            await this.main.teamSyncer.onChannelAdded(teamId, eventDetails.channel.id, eventDetails.channel.name, eventDetails.channel.creator);
        } else if (event.type === "channel_deleted") {
            await this.main.teamSyncer.onChannelDeleted(teamId, event.channel);
        } else if (event.type === "team_join" || event.type === "user_change") {
            const user = event.user as unknown as ISlackUser;
            const domain = (await this.main.datastore.getTeam(teamId))!.domain;
            await this.main.teamSyncer.syncUser(teamId, domain, user);
        }
    }
}
