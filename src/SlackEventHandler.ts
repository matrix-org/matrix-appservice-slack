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

import { BaseSlackHandler, ISlackEvent, ISlackMessageEvent, ISlackUser } from "./BaseSlackHandler";
import { BridgedRoom } from "./BridgedRoom";
import { Main, METRIC_RECEIVED_MESSAGE } from "./Main";
import { Logger } from "matrix-appservice-bridge";
const log = new Logger("SlackEventHandler");

/**
 * https://api.slack.com/events/channel_rename
 */
interface ISlackEventChannelRename extends Omit<ISlackEvent, "channel"> {
    channel: {
        id: string;
        name: string;
        created: number;
    }
}

/**
 * https://api.slack.com/events/team_domain_change
 */
interface ISlackEventTeamDomainChange extends ISlackEvent {
    url: string;
    domain: string;
}

/**
 * https://api.slack.com/events/reaction_added
 */
interface ISlackEventReaction extends ISlackEvent {
    event_ts: string;
    item: {
        channel: string;
        text?: string;
        ts: string;
    };
    reaction: string;
    user: string;
}

/**
 * https://api.slack.com/events/user_typing
 */
interface ISlackEventUserTyping extends ISlackEvent {
    user: string;
}

/**
 * https://api.slack.com/events/channel_created
 */
interface ISlackEventChannelCreated {
    type: string;
    channel: {
        id: string;
        name: string;
        created: number;
        creator: string;
    };
}

/**
 * A container for multiple event types which we only handle,
 * if team_sync is enabled.
 */
interface ISlackTeamSyncEvent extends ISlackEvent {
    user?: ISlackUser;
}

interface ISlackMemberJoinedEvent extends ISlackEvent {
    user: string;
    channel: string;
    channel_type: "C"|"G";
    team: string;
    inviter: string;
}

interface ISlackMemberLeftEvent extends ISlackEvent {
    user: string;
    channel: string;
    channel_type: "C"|"G";
    team: string;
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
        "team_domain_change", "channel_rename", "user_change", "user_typing", "member_joined_channel",
        "channel_created", "channel_deleted", "team_join"];
    constructor(main: Main) {
        super(main);
    }

    public onVerifyUrl(challenge: string, response: EventHandlerCallback): void {
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
    public async handle(event: ISlackEvent, teamId: string, response: EventHandlerCallback, isEventAndUsingRtm: boolean): Promise<void> {
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
                await this.handleEvent(event, teamId);
            } catch (ex) {
                err = ex as Error;
            }

            if (err === null) {
                endTimer({outcome: "success"});
            } else if (!(err instanceof Error)) {
                log.warn("Error when handing event:", err);
                endTimer({outcome: "fail"});
            } else if (err.message === "unknown_channel") {
                const chanIdMix = `${event.channel} (${teamId})`;
                log.warn(`Ignoring message from unrecognised slack channel id: ${chanIdMix}`);
                this.main.incCounter(METRIC_RECEIVED_MESSAGE, {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_team") {
                log.warn(`Ignoring message from unrecognised slack team id: ${teamId}`);
                this.main.incCounter(METRIC_RECEIVED_MESSAGE, {side: "remote"});
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_message") {
                log.warn(`Ignoring event because we couldn't find a referred to message`);
                endTimer({outcome: "dropped"});
                return;
            } else if (err.message === "unknown_event" || err.message === "ignored") {
                log.debug(`Didn't handle event: ${err.message}`);
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

    protected async handleEvent(event: ISlackEvent, teamId: string): Promise<void> {
        switch (event.type) {
            case "message":
                await this.handleMessageEvent(event as ISlackMessageEvent, teamId);
                break;
            case "reaction_added":
            case "reaction_removed":
                await this.handleReaction(event as ISlackEventReaction, teamId);
                break;
            case "channel_rename":
                // The rename event is not compatible with ISlackEvent because the channel property is an object,
                // not a string. So we resort to casting to unknown first.
                // TODO: Move channel property out of ISlackEvent, into each event type, where relevant.
                await this.handleChannelRenameEvent((event as unknown) as ISlackEventChannelRename);
                break;
            case "team_domain_change":
                await this.handleDomainChangeEvent(event as ISlackEventTeamDomainChange, teamId);
                break;
            case "user_typing":
                await this.handleTyping(event as ISlackEventUserTyping, teamId);
                break;
            case "channel_created":
            case "channel_deleted":
            case "user_change":
            case "team_join":
                await this.handleTeamSyncEvent(event as ISlackTeamSyncEvent, teamId);
                break;
            case "member_joined_channel":
                await this.handleMemberJoinedChannel(event as ISlackMemberJoinedEvent);
                break;
            case "member_left_channel":
                await this.handleMemberLeftChannel(event as ISlackMemberLeftEvent);
            case "file_comment_added":
            default:
                throw Error("unknown_event");
        }
    }

    /**
     * Attempts to handle the `message` event.
     *
     * Sends a message to Matrix if it understands enough of the message to do so.
     * Attempts to make the message as native-matrix feeling as it can.
     * @param ISlackEventParamsMessage The slack message event to handle.
     */
    protected async handleMessageEvent(event: ISlackMessageEvent, teamId: string): Promise<void> {
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
        this.main.incCounter(METRIC_RECEIVED_MESSAGE, {side: "remote"});

        const msg = {
            ...event,
            channel_id: event.channel,
            team_domain: team.domain || team.id,
            team_id: teamId,
            user_id: event.user || event.bot_id!,
        };

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
                msg.text = await this.doChannelUserReplacements(msg, msg.text, room.SlackClient);
                return await room.onSlackMessage(msg);
            }
            if (msg.text === "") {
                return;
            }
        }

        // In this method we must standardise the message object so that
        // getGhostForSlackMessage works correctly.
        if (msg.subtype === "file_comment" && msg.comment) {
            msg.user_id = msg.comment.user;
        } else if (msg.subtype === "message_changed" && msg.message && msg.previous_message) {
            msg.user_id = msg.message.user!;
            msg.text = msg.message.text;
            msg.previous_message.text = await this.doChannelUserReplacements(
                msg, msg.previous_message?.text, room.SlackClient
            );

            // Check if the edit was sent by a bot
            if (msg.message.bot_id !== undefined) {
                // Check the edit wasn't sent by us
                if (msg.message.bot_id === team.bot_id) {
                    return;
                } else {
                    msg.user_id = msg.message.bot_id;
                }
            }
        } else if (msg.subtype === "message_deleted" && msg.deleted_ts) {
            const originalEvent = await this.main.datastore.getEventBySlackId(msg.channel, msg.deleted_ts);
            if (originalEvent) {
                const botClient = this.main.botIntent.matrixClient;
                await botClient.redactEvent(originalEvent.roomId, originalEvent.eventId);
                return;
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

        msg.text = await this.doChannelUserReplacements(msg, msg.text, room.SlackClient);
        return room.onSlackMessage(msg);
    }

    private async handleReaction(event: ISlackEventReaction, teamId: string) {
        // Reactions store the channel in the item
        const channel = event.item.channel;
        const room = this.main.rooms.getBySlackChannelId(channel) as BridgedRoom;
        const team = await this.main.datastore.getTeam(teamId);
        const userOrBotId = event.user || event.bot_id;
        if (!room) { throw Error("unknown_channel"); }
        if (!team) { throw Error("unknown_team"); }
        if (!userOrBotId) { throw Error("event_without_sender"); }

        const msg =  {
            ...event,
            channel_id: channel,
            team_domain: team.domain || room.SlackTeamId,
            team_id: teamId,
            user_id: userOrBotId,
        };

        if (event.type === "reaction_added") {
            await room.onSlackReactionAdded(msg, teamId);
        } else if (event.type === "reaction_removed") {
            await room.onSlackReactionRemoved(msg);
        }
    }

    private async handleDomainChangeEvent(event: ISlackEventTeamDomainChange, teamId: string) {
        const team = await this.main.datastore.getTeam(teamId);
        if (team) {
            team.domain = event.domain;
            await this.main.datastore.upsertTeam(team);
        }
    }

    private async handleChannelRenameEvent(event: ISlackEventChannelRename) {
        const room = this.main.rooms.getBySlackChannelId(event.channel.id);
        if (!room) { throw new Error("unknown_channel"); }

        room.SlackChannelName = `#${event.channel.name}`;
        if (room.isDirty) {
            await this.main.datastore.upsertRoom(room);
        }
    }

    private async handleTyping(event: ISlackEventUserTyping, teamId: string) {
        const room = this.main.rooms.getBySlackChannelId(event.channel);
        const team = await this.main.datastore.getTeam(teamId);
        const userOrBotId = event.user || event.bot_id;
        if (!room) { throw Error("unknown_channel"); }
        if (!team) { throw Error("unknown_team"); }
        if (!userOrBotId) { throw Error("event_without_sender"); }

        const typingEvent = {
            ...event,
            channel_id: event.channel,
            team_domain: team.domain || room.SlackTeamId,
            team_id: teamId,
            user_id: userOrBotId,
        };
        await room.onSlackTyping(typingEvent, teamId);
    }

    private async handleTeamSyncEvent(event: ISlackTeamSyncEvent, teamId: string) {
        if (!this.main.teamSyncer) {
            throw Error("ignored");
        }
        if (event.type === "channel_created") {
            // Note: Slack violates the usual stringness of 'channel' here.
            const eventDetails = event as unknown as ISlackEventChannelCreated;
            await this.main.teamSyncer.onChannelAdded(teamId, eventDetails.channel.id, eventDetails.channel.name, eventDetails.channel.creator);
        } else if (event.type === "channel_deleted") {
            await this.main.teamSyncer.onChannelDeleted(teamId, event.channel);
        } else if (event.type === "team_join" || event.type === "user_change") {
            const user = event.user!;
            const domain = (await this.main.datastore.getTeam(teamId))!.domain;
            await this.main.teamSyncer.syncUser(teamId, domain, user);
        }
    }

    private async handleMemberJoinedChannel(event: ISlackMemberJoinedEvent) {
        const room = this.main.rooms.getBySlackChannelId(event.channel);
        if (room) {
            return room.onSlackUserJoin(event.user, event.inviter);
        }
    }

    private async handleMemberLeftChannel(event: ISlackMemberLeftEvent) {
        const room = this.main.rooms.getBySlackChannelId(event.channel);
        if (room) {
            return room.onSlackUserLeft(event.user);
        }
    }
}
