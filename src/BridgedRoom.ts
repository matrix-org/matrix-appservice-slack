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

import * as rp from "request-promise-native";
import { Logging, Intent } from "matrix-appservice-bridge";
import { SlackGhost } from "./SlackGhost";
import { Main, METRIC_SENT_MESSAGES } from "./Main";
import { default as substitutions, getFallbackForMissingEmoji, IMatrixToSlackResult } from "./substitutions";
import * as emoji from "node-emoji";
import { ISlackMessageEvent, ISlackEvent } from "./BaseSlackHandler";
import { WebClient } from "@slack/web-api";
import { ChatUpdateResponse,
    ChatPostMessageResponse, ConversationsInfoResponse, TeamInfoResponse } from "./SlackResponses";
import { RoomEntry, EventEntry, TeamEntry } from "./datastore/Models";
import { getBridgeStateKey, BridgeStateType, buildBridgeStateEvent } from "./RoomUtils";
import { tenRetriesInAboutThirtyMinutes } from "@slack/web-api/dist/retry-policies";
import e = require("express");

const log = Logging.get("BridgedRoom");

export interface IBridgedRoomOpts {
    matrix_room_id: string;
    inbound_id: string;
    slack_channel_name?: string;
    slack_channel_id?: string;
    slack_webhook_uri?: string;
    slack_team_id?: string;
    slack_type?: string;
    is_private?: boolean;
    puppet_owner?: string;
}

interface ISlackChatMessagePayload extends IMatrixToSlackResult {
    as_user?: boolean;
    channel?: string;
    thread_ts?: string;
    icon_url?: string;
}

const RECENT_MESSAGE_MAX = 10;
const PUPPET_INCOMING_DELAY_MS = 1500;

export class BridgedRoom {
    public get isDirty() {
        return this.dirty;
    }

    public get InboundId() {
        return this.inboundId;
    }

    public set InboundId(value) {
        this.setValue("inboundId", value);
    }

    public get SlackChannelId() {
        return this.slackChannelId;
    }

    public set SlackChannelId(value) {
        this.setValue("slackChannelId", value);
    }

    public get SlackChannelName() {
        return this.slackChannelName;
    }

    public set SlackChannelName(value) {
        this.setValue("slackChannelName", value);
    }

    public get SlackWebhookUri() {
        return this.slackWebhookUri;
    }

    public set SlackWebhookUri(value) {
        this.setValue("slackWebhookUri", value);
    }

    public get MatrixRoomId() {
        return this.matrixRoomId;
    }

    public get SlackTeamId() {
        return this.slackTeamId;
    }

    public get RemoteATime() {
        return this.slackATime;
    }

    public get MatrixATime() {
        return this.matrixATime;
    }

    public get SlackClient() {
        return this.botClient;
    }

    public get IsPrivate() {
        return this.isPrivate;
    }

    public get SlackType() {
        return this.slackType;
    }

    protected matrixRoomId: string;
    protected inboundId: string;
    protected slackChannelName?: string;
    protected slackChannelId?: string;
    protected slackWebhookUri?: string;
    protected slackTeamId?: string;
    protected slackType?: string;
    protected isPrivate?: boolean;
    protected puppetOwner?: string;

    // last activity time in epoch seconds
    private slackATime?: number;
    private matrixATime?: number;
    private intent: Intent;
    // Is the matrix room in use by the bridge.
    public MatrixRoomActive: boolean;
    private recentSlackMessages: string[] = [];

    private slackSendLock: Promise<void> = Promise.resolve();

    /**
     * True if this instance has changed from the version last read/written to the RoomStore.
     */
    private dirty: boolean;

    constructor(protected main: Main, opts: IBridgedRoomOpts, private team?: TeamEntry, private botClient?: WebClient) {

        this.MatrixRoomActive = true;
        if (!opts.inbound_id) {
            throw Error("BridgedRoom requires an inbound ID");
        }
        if (!opts.matrix_room_id) {
            throw Error("BridgedRoom requires an Matrix Room ID");
        }

        this.matrixRoomId = opts.matrix_room_id;
        this.inboundId = opts.inbound_id;
        this.slackChannelName = opts.slack_channel_name;
        this.slackChannelId = opts.slack_channel_id;
        this.slackWebhookUri = opts.slack_webhook_uri;
        this.slackTeamId = opts.slack_team_id;
        this.slackType = opts.slack_type || "channel";
        if (opts.is_private === undefined) {
            opts.is_private = false;
        }
        this.isPrivate = opts.is_private;
        this.puppetOwner = opts.puppet_owner;
        this.dirty = true;
    }

    public updateUsingChannelInfo(channelInfo: ConversationsInfoResponse) {
        const chan = channelInfo.channel;
        this.setValue("isPrivate", chan.is_private);
        if (chan.is_channel) {
            this.setValue("slackType", "channel");
        } else if (chan.is_mpim) {
            // note: is_group is also set for mpims, so order is important
            this.setValue("slackType", "mpim");
        } else if (chan.is_group) {
            this.setValue("slackType", "group");
        } else if (chan.is_im) {
            this.setValue("slackType", "im");
        } else {
            this.setValue("slackType", "unknown");
        }
    }

    public getStatus() {
        if (!this.slackWebhookUri && !this.botClient) {
            return "pending-params";
        }
        if (!this.slackChannelName) {
            return "pending-name";
        }
        if (!this.botClient) {
            return "ready-no-token";
        }
        return "ready";
    }

    /**
     * Returns data to write to the RoomStore
     * As a side-effect will also clear the isDirty() flag
     */
    public toEntry(): RoomEntry {
        const entry = {
            id: `INTEG-${this.inboundId}`,
            matrix_id: this.matrixRoomId,
            remote: {
                id: this.slackChannelId!,
                name: this.slackChannelName!,
                slack_team_id: this.slackTeamId!,
                slack_type: this.slackType!,
                slack_private: this.isPrivate!,
                webhook_uri: this.slackWebhookUri!,
                puppet_owner: this.puppetOwner!,
            },
            remote_id: this.inboundId,
        };
        this.dirty = false;
        return entry;
    }

    public async onMatrixReaction(message: any) {
        if (!this.botClient) { return; }

        const relatesTo = message.content["m.relates_to"];
        const eventStore = this.main.datastore;
        const event = await eventStore.getEventByMatrixId(message.room_id, relatesTo.event_id);

        // If we don't get an event then exit
        if (event === null) {
            log.debug("Could not find event to react to.");
            return;
        }

        // Convert the unicode emoji into a slack emote name
        let emojiKeyName: string;
        const emojiItem = emoji.find(relatesTo.key);
        if (emojiItem !== undefined) {
            emojiKeyName = emojiItem.key;
        } else {
            emojiKeyName = relatesTo.key;
            // Strip the colons
            if (emojiKeyName.startsWith(":") && emojiKeyName.endsWith(":")) {
                emojiKeyName = emojiKeyName.substring(1, emojiKeyName.length - 1);
            }
        }
        let client: WebClient = this.botClient;
        const puppet = await this.main.clientFactory.getClientForUserWithId(this.SlackTeamId!, message.sender);
        if (puppet) {
            client = puppet.client;
            // We must do this before sending to avoid racing
            // Use the unicode key for uniqueness
            this.addRecentSlackMessage(`reactadd:${relatesTo.key}:${puppet.id}:${event.slackTs}`);
        }

        // TODO: This only works once from matrix if we are sending the event as the
        // bot user.
        const res = await client.reactions.add({
            as_user: false,
            channel: this.slackChannelId,
            name: emojiKeyName,
            timestamp: event.slackTs,
        });
        log.info(`Reaction :${emojiKeyName}: added to ${event.slackTs}`);

        if (!res.ok) {
            log.error("HTTP Error: ", res.error);
            return;
        }
        // TODO: Add this event to the event store
        // Unfortunately reactions.add does not return the ts of the reactions event.
        // So we can't store it in the event store
    }

    public async onMatrixRedaction(message: any) {
        if (!this.botClient) { return; }
        const event = await this.main.datastore.getEventByMatrixId(message.room_id, message.redacts);

        // If we don't get an event then exit
        if (event === null) {
            log.debug(`Could not find event '${message.redacts}' in room '${message.room_id}' to delete.`);
            return;
        }

        const client = (await this.main.clientFactory.getClientForUser(this.SlackTeamId!, message.sender)) || this.botClient;
        const res = await client.chat.delete({
            as_user: false,
            channel: this.slackChannelId!,
            ts: event.slackTs,
        });

        if (!res.ok) {
            log.error("HTTP Error: ", res.error);
            return;
        }
        return res;
    }

    public async onMatrixEdit(message: any) {
        if (!this.botClient) { return false; }

        const event = await this.main.datastore.getEventByMatrixId(
            message.room_id,
            message.content["m.relates_to"].event_id,
        );

        if (!event) {
            log.debug("Skipping matrix edit because couldn't find event in datastore");
            return false;
        }
        // re-write the message so the matrixToSlack converter works as expected.
        let newMessage = JSON.parse(JSON.stringify(message));
        newMessage.content = message.content["m.new_content"];
        newMessage = await this.stripMatrixReplyFallback(newMessage);

        const body = await substitutions.matrixToSlack(newMessage, this.main, this.SlackTeamId!);

        if (!body || !body.text) {
            log.warn(`Dropped edit ${message.event_id}, message content could not be identified`);
            // Could not handle content, dropped
            return false;
        }

        const res = (await this.botClient.chat.update({
            ts: event.slackTs,
            as_user: false,
            channel: this.slackChannelId!,
            ...body,
            // We include this for type safety as Typescript isn't aware that body.text is defined
            // from the ...body statement.
            text: body.text,
        })) as ChatUpdateResponse;

        this.main.incCounter(METRIC_SENT_MESSAGES, {side: "remote"});
        if (!res.ok) {
            log.error("HTTP Error: ", res.error);
            throw Error("Failed to send");
        }
        // Add this event to the event store
        await this.main.datastore.upsertEvent(
            message.room_id,
            message.event_id,
            this.slackChannelId!,
            res.ts,
        );
        return true;
    }

    public async onMatrixMessage(message: any) {
        const puppetedClient = await this.main.clientFactory.getClientForUser(this.SlackTeamId!, message.user_id);
        if (!this.slackWebhookUri && !this.botClient) { return false; }
        const slackClient = puppetedClient || this.botClient;
        const user = this.main.getOrCreateMatrixUser(message.user_id);
        message = await this.stripMatrixReplyFallback(message);
        const matrixToSlackResult = await substitutions.matrixToSlack(message, this.main, this.SlackTeamId!);
        if (!matrixToSlackResult) {
            // Could not handle content, dropped.
            log.warn(`Dropped ${message.event_id}, message content could not be identified`);
            return false;
        }
        const body: ISlackChatMessagePayload = {
            ...matrixToSlackResult,
            as_user: false,
            username: user.getDisplaynameForRoom(message.room_id) || matrixToSlackResult.username,
        };
        const text = body.text;
        if (!body.attachments && !text) {
            // The message type might not be understood. In any case, we can't send something without
            // text.
            log.warn(`Dropped ${message.event_id}, message had no attachments or text`);
            return false;
        }
        const reply = await this.findParentReply(message);
        let parentStoredEvent: EventEntry | null = null;
        if (reply !== message.event_id) {
            parentStoredEvent = await this.main.datastore.getEventByMatrixId(message.room_id, reply);
            // We have a reply
            if (parentStoredEvent) {
                body.thread_ts = parentStoredEvent.slackTs;
            }
        }

        const avatarUrl = user.getAvatarUrlForRoom(message.room_id);

        if (avatarUrl && avatarUrl.indexOf("mxc://") === 0) {
            body.icon_url = this.main.getUrlForMxc(avatarUrl);
        }

        user.bumpATime();
        this.matrixATime = Date.now() / 1000;
        if (!slackClient) {
            const sendMessageParams = {
                body,
                as_user: undefined,
                headers: {},
                json: true,
                method: "POST",
                uri: this.slackWebhookUri!,
            };
            const webhookRes = await rp(sendMessageParams);
            if (webhookRes !== "ok") {
                log.error("Failed to send webhook message");
            }
            // Webhooks don't give us any ID, so we can't store this.
            return true;
        }
        if (puppetedClient) {
            body.as_user = true;
            delete body.username;
        }
        const res = (await slackClient.chat.postMessage({
            ...body,
            // Ensure that text is defined, even for attachments.
            text: text || "",
            channel: this.slackChannelId!,
            unfurl_links: true,
        })) as ChatPostMessageResponse;

        this.addRecentSlackMessage(res.ts);

        this.main.incCounter(METRIC_SENT_MESSAGES, {side: "remote"});

        if (!res.ok) {
            log.error("HTTP Error: ", res.error);
            throw Error("Failed to send");
        }

        // Add this event to the event store
        await this.main.datastore.upsertEvent(
            message.room_id,
            message.event_id,
            this.slackChannelId!,
            res.ts,
        );

        // If this message is in a slack thread we need to append this message to the end of the thread list.
        if (parentStoredEvent) {
            if (parentStoredEvent._extras.slackThreadMessages === undefined) {
                parentStoredEvent._extras.slackThreadMessages = [];
            }
            parentStoredEvent._extras.slackThreadMessages.push(res.ts);
            await this.main.datastore.upsertEvent(parentStoredEvent);
        }
        return true;
    }

    public async onSlackMessage(message: ISlackMessageEvent, content?: Buffer) {
        if (this.slackTeamId && message.user) {
            // This just checks if the user *could* be puppeted. If they are, delay handling their incoming messages.
            const hasPuppet = null !== await this.main.datastore.getPuppetTokenBySlackId(this.slackTeamId, message.user);
            if (hasPuppet) {
                await new Promise((r) => setTimeout(r, PUPPET_INCOMING_DELAY_MS));
            }
        }
        if (this.recentSlackMessages.includes(message.ts)) {
            // We sent this, ignore.
            return;
        }
        // Dedupe across RTM/Event streams
        this.addRecentSlackMessage(message.ts);
        try {
            const ghost = await this.main.getGhostForSlackMessage(message, this.slackTeamId!);
            await ghost.update(message, this);
            await ghost.cancelTyping(this.MatrixRoomId); // If they were typing, stop them from doing that.
            this.slackSendLock = this.slackSendLock.finally(async () => {
                return this.handleSlackMessage(message, ghost, content);
            });
            await this.slackSendLock;
        } catch (err) {
            log.error("Failed to process event");
            log.error(err);
        }
    }

    public async onSlackReactionAdded(message: any, teamId: string) {
        if (message.user_id === this.team!.user_id) {
            return;
        }

        const reaction = `:${message.reaction}:`;
        const reactionKey = emoji.emojify(reaction, getFallbackForMissingEmoji);

        if (this.recentSlackMessages.includes(`reactadd:${reactionKey}:${message.user_id}:${message.item.ts}`)) {
            // We sent this, ignore.
            return;
        }
        const ghost = await this.main.getGhostForSlackMessage(message, teamId);
        await ghost.update(message, this);

        const event = await this.main.datastore.getEventBySlackId(message.item.channel, message.item.ts);

        if (event === null) {
            return;
        }
        log.debug(`Sending reaction ${reactionKey} for ${event.eventId} as ${ghost.userId}`);
        return ghost.sendReaction(this.MatrixRoomId, event.eventId, reactionKey,
                                  message.item.channel, message.event_ts);
    }

    public async onSlackTyping(event: ISlackEvent, teamId: string) {
        const ghost = await this.main.getGhostForSlackMessage(event, teamId);
        await ghost.sendTyping(this.MatrixRoomId);
    }

    public async leaveGhosts(ghosts: string[]) {
        const promises: Promise<void>[] = [];
        for (const ghost of ghosts) {
            promises.push(this.main.getIntent(ghost).leave(this.matrixRoomId));
        }
        await Promise.all(promises);
    }

    public setBotClient(slackClient: WebClient) {
        this.botClient = slackClient;
    }

    public async syncBridgeState(force = false) {
        if (!this.slackTeamId || !this.slackChannelId || this.isPrivate) {
            return; // TODO: How to handle this?
        }
        const intent = await this.main.botIntent;
        const key = getBridgeStateKey(this.slackTeamId, this.slackChannelId);
        if (!force) {
            // This throws if it can't find the event.
            try {
                await intent.getStateEvent(
                    this.MatrixRoomId,
                    BridgeStateType,
                    key,
                );
                return;
            } catch (ex) {
                if (ex.message !== "Event not found.") {
                    throw ex;
                }
            }
        }

        const { team } = await this.botClient!.team.info() as TeamInfoResponse;
        let icon: string|undefined;
        if (team.icon && !team.icon.image_default) {
            const iconUrl = team.icon[Object.keys(team.icon).filter((s) => s !== "icon_default").sort().reverse()[0]];

            const response = await rp({
                encoding: null,
                resolveWithFullResponse: true,
                uri: iconUrl,
            });
            const content = response.body as Buffer;

            icon = await intent.getClient().uploadContent(content, {
                name: "workspace-icon.png",
                type: response.headers["content-type"],
                rawResponse: false,
                onlyContentUri: true,
            });
        }

        // No state, build one.
        const event = buildBridgeStateEvent({
            workspaceId: this.slackTeamId,
            workspaceName: team.name,
            workspaceUrl: `https://${team.domain}.slack.com`,
            workspaceLogo: icon,
            channelId: this.slackChannelId,
            channelName: this.slackChannelName || undefined,
            channelUrl: `https://app.slack.com/client/${this.slackTeamId}/${this.slackChannelId}`,
            isActive: true,
        });
        await intent.sendStateEvent(this.MatrixRoomId, event.type, key, event.content);
    }

    private setValue<T>(key: string, value: T) {
        const sneakyThis = this as any;
        if (sneakyThis[key] === value) {
            return;
        }
        sneakyThis[key] = value;
        this.dirty = true;
    }

    private async handleSlackMessage(message: ISlackMessageEvent, ghost: SlackGhost, content?: Buffer) {
        const eventTS = message.event_ts || message.ts;
        const channelId = this.slackChannelId!;

        ghost.bumpATime();
        this.slackATime = Date.now() / 1000;

        const subtype = message.subtype;

        // Transform the text if it is present.
        if (message.text) {
            message.text = substitutions.slackToMatrix(message.text,
                subtype === "file_comment" ? message.file : undefined);
        }

        if (message.thread_ts !== undefined && message.text) {
            let replyMEvent = await this.getReplyEvent(this.MatrixRoomId, message, this.SlackChannelId!);
            if (replyMEvent) {
                replyMEvent = await this.stripMatrixReplyFallback(replyMEvent);
                return await ghost.sendWithReply(
                    this.MatrixRoomId, message.text, this.SlackChannelId!, eventTS, replyMEvent,
                );
            }
        }

        // If we are only handling text, send the text. File messages are handled in a seperate block.
        if (["bot_message", "file_comment", undefined].includes(subtype) && message.files === undefined) {
            return ghost.sendText(this.matrixRoomId, message.text!, channelId, eventTS);
        } else if (subtype === "me_message") {
            return ghost.sendMessage(this.matrixRoomId, {
                body: message.text!,
                msgtype: "m.emote",
            }, channelId, eventTS);
        } else if (subtype === "message_changed") {
            const previousMessage = ghost.prepareBody(substitutions.slackToMatrix(message.previous_message!.text!));
            // We use message.text here rather than the proper message.message.text
            // as we have added message.text ourselves and then transformed it.
            const newMessageRich = substitutions.slackToMatrix(message.text!);
            const newMessage = ghost.prepareBody(newMessageRich);

            // The substitutions might make the messages the same
            if (previousMessage === newMessage) {
                log.debug("Ignoring edit message because messages are the same post-substitutions.");
                return;
            }

            const edits = substitutions.makeDiff(previousMessage, newMessage);

            const outtext = `(edited) ${edits.before} ${edits.prev} ${edits.after} => ` +
                `${edits.before} ${edits.curr}  ${edits.after}`;

            const prev   = substitutions.htmlEscape(edits.prev);
            const curr   = substitutions.htmlEscape(edits.curr);
            const before = substitutions.htmlEscape(edits.before);
            const after  = substitutions.htmlEscape(edits.after);

            let formatted = `<i>(edited)</i> ${before} <font color="red"> ${prev} </font> ${after} =&gt; ${before}` +
            `<font color="green"> ${curr} </font> ${after}`;
            const prevEvent = await this.main.datastore.getEventBySlackId(channelId, message.previous_message!.ts);

            // If this edit is in a thread we need to inject the reply fallback, or
            // non-reply supporting clients will no longer show it as a reply.
            let body = ghost.prepareBody(outtext);

            let newBody = ghost.prepareBody(newMessageRich);
            let newFormattedBody = ghost.prepareFormattedBody(newMessageRich);
            if (message.message && message.message.thread_ts !== undefined) {
                let replyEvent = await this.getReplyEvent(
                    this.MatrixRoomId, message.message as unknown as ISlackMessageEvent, this.slackChannelId!,
                );
                replyEvent = this.stripMatrixReplyFallback(replyEvent);
                if (replyEvent) {
                    const bodyFallback = ghost.getFallbackText(replyEvent);
                    const formattedFallback = ghost.getFallbackHtml(this.MatrixRoomId, replyEvent);
                    body = `${bodyFallback}\n\n${body}`;
                    formatted = formattedFallback + formatted;
                    newBody = bodyFallback + newBody;
                    newFormattedBody = formattedFallback + newFormattedBody;
                }
            }
            let replyContent: object|undefined;
            // Only include edit metadata in the message if we have the previous eventId,
            // otherwise just send the fallback reply text.
            if (prevEvent) {
                replyContent = {
                    "m.new_content": {
                        body: newBody,
                        format: "org.matrix.custom.html",
                        formatted_body: newFormattedBody,
                        msgtype: "m.text",
                    },
                    "m.relates_to": {
                        event_id: prevEvent.eventId,
                        rel_type: "m.replace",
                    },
                };
            } else {
                log.warn("Got edit but no previous matrix events were found");
            }
            const matrixContent = {
                body,
                format: "org.matrix.custom.html",
                formatted_body: formatted,
                msgtype: "m.text",
                ...replyContent,
            };
            return ghost.sendMessage(this.MatrixRoomId, matrixContent, channelId, eventTS);
        } else if (message.files) { // A message without a subtype can contain files.
            const maxUploadSize = this.main.config.homeserver.max_upload_size;
            for (const file of message.files) {
                if (!file.url_private) {
                    // Cannot do anything with this.
                    continue;
                }

                if (file.mode === "snippet") {
                    let htmlString: string;
                    try {
                        htmlString = await rp({
                            headers: {
                                Authorization: `Bearer ${this.SlackClient!.token}`,
                            },
                            uri: file.url_private!,
                        });
                    } catch (ex) {
                        log.error("Failed to download snippet", ex);
                        continue;
                    }
                    let htmlCode = "";
                    // Because escaping 6 backticks is not good for readability.
                    // tslint:disable-next-line: prefer-template
                    const code = "```" + `\n${htmlString}\n` + "```";
                    if (file.filetype) {
                        htmlCode = `<pre><code class="language-${file.filetype}'">`;
                    } else {
                        htmlCode = "<pre><code>";
                    }
                    htmlCode += substitutions.htmlEscape(htmlString);
                    htmlCode += "</code></pre>";

                    const messageContent = {
                        body: code,
                        format: "org.matrix.custom.html",
                        formatted_body: htmlCode,
                        msgtype: "m.text",
                    };
                    await ghost.sendMessage(this.matrixRoomId, messageContent, channelId, eventTS);
                } else {
                    if (maxUploadSize && file.size > maxUploadSize) {
                        const link = file.public_url_shared ? file.permalink_public : file.url_private;
                        log.info("File too large, sending as a link");
                        const messageContent = {
                            body: `${link} (${file.name})`,
                            format: "org.matrix.custom.html",
                            formatted_body: `<a href="${link}">${file.name}</a>`,
                            msgtype: "m.text",
                        };
                        await ghost.sendMessage(this.matrixRoomId, messageContent, channelId, eventTS);
                        continue;
                    }
                    // We also need to upload the thumbnail
                    let thumbnailPromise: Promise<string> = Promise.resolve("");
                    // Slack ain't a believer in consistency.
                    const thumbUri = file.thumb_video || file.thumb_360;
                    if (thumbUri && file.filetype) {
                        thumbnailPromise = ghost.uploadContentFromURI(
                            {
                                mimetype: file.mimetype,
                                title: `${file.name}_thumb.${file.filetype}`,
                            },
                            thumbUri,
                            this.SlackClient!.token!,
                        );
                    }
                    const fileContentUri = await ghost.uploadContentFromURI(
                        file, file.url_private, this.SlackClient!.token!);
                    const thumbnailContentUri = await thumbnailPromise;
                    await ghost.sendMessage(
                        this.matrixRoomId,
                        slackFileToMatrixMessage(file, fileContentUri, thumbnailContentUri),
                        channelId,
                        eventTS,
                    );
                }
            }
            // TODO: Currently Matrix lacks a way to upload a "captioned image",
            //   so we just send a separate `m.image` and `m.text` message
            // See https://github.com/matrix-org/matrix-doc/issues/906
            if (message.text) {
                return ghost.sendText(this.matrixRoomId, message.text, channelId, eventTS);
            }
        } else {
            log.warn(`Ignoring message with subtype: ${subtype}`);
        }
    }

    private async getReplyEvent(roomID: string, message: ISlackMessageEvent, slackRoomID: string) {
        // Get parent event
        const dataStore = this.main.datastore;
        const parentEvent = await dataStore.getEventBySlackId(slackRoomID, message.thread_ts!);
        if (parentEvent === null) {
            return null;
        }
        let replyToTS = "";
        // Add this event to the list of events in this thread
        if (parentEvent._extras.slackThreadMessages === undefined) {
            parentEvent._extras.slackThreadMessages = [];
        }
        replyToTS = parentEvent._extras.slackThreadMessages.slice(-1)[0] || message.thread_ts!;
        parentEvent._extras.slackThreadMessages.push(message.ts);
        await dataStore.upsertEvent(parentEvent);

        // Get event to reply to
        const replyToEvent = await dataStore.getEventBySlackId(slackRoomID, replyToTS);
        if (replyToEvent === null) {
            return null;
        }
        const intent = await this.getIntentForRoom();
        return await intent.getClient().fetchRoomEvent(roomID, replyToEvent.eventId);
    }

    /*
        Strip out reply fallbacks. Borrowed from
        https://github.com/turt2live/matrix-js-bot-sdk/blob/master/src/preprocessors/RichRepliesPreprocessor.ts
    */
    private async stripMatrixReplyFallback(event: any): Promise<any> {
        let realHtml = event.content.formatted_body;
        let realText = event.content.body;

        if (event.content.format === "org.matrix.custom.html" && event.content.formatted_body) {
            const formattedBody = event.content.formatted_body;
            if (formattedBody.startsWith("<mx-reply>") && formattedBody.indexOf("</mx-reply>") !== -1) {
                const parts = formattedBody.split("</mx-reply>");
                realHtml = parts[1];
                event.content.formatted_body = realHtml.trim();
            }
        }

        let processedFallback = false;
        const body = event.content.body || "";
        for (const line of body.split("\n")) {
            if (line.startsWith("> ") && !processedFallback) {
                continue;
            } else if (!processedFallback) {
                realText = line;
                processedFallback = true;
            } else {
                realText += line + "\n";
            }
        }

        event.content.body = realText.trim();
        return event;
    }

    /*
        Given an event which is in reply to something else return the event ID of the
        top most event in the reply chain, i.e. the one without a relates to.
    */
    private async findParentReply(message: any, depth: number = 0): Promise<string> {
        const MAX_DEPTH = 10;
        // Extract the referenced event
        if (!message.content) { return message.event_id; }
        if (!message.content["m.relates_to"]) { return message.event_id; }
        if (!message.content["m.relates_to"]["m.in_reply_to"]) { return message.event_id; }
        const parentEventId = message.content["m.relates_to"]["m.in_reply_to"].event_id;
        if (!parentEventId) { return message.event_id; }
        if (depth > MAX_DEPTH) {
            return parentEventId; // We have hit our depth limit, use this one.
        }

        const intent = await this.getIntentForRoom();
        const nextEvent = await intent.getClient().fetchRoomEvent(this.MatrixRoomId, parentEventId);

        return this.findParentReply(nextEvent, depth++);
    }

    protected async getIntentForRoom() {
        if (this.intent) {
            return this.intent;
        }
        // Ensure we get the right user.
        if (!this.IsPrivate) {
            this.intent = this.main.botIntent; // Non-private channels should have the bot inside.
        }
        const firstGhost = (await this.main.listGhostUsers(this.MatrixRoomId))[0];
        this.intent =  this.main.getIntent(firstGhost);
        return this.intent;
    }

    private addRecentSlackMessage(ts: string) {
        log.debug("Recent message key add:", ts);
        this.recentSlackMessages.push(ts);
        if (this.recentSlackMessages.length > RECENT_MESSAGE_MAX) {
            this.recentSlackMessages.shift();
        }
    }
}

/**
 * Converts a slack image attachment to a matrix image event.
 *
 * @param {Object} file The slack image attachment file object.
 * @param {?integer} file.size size of the file in bytes.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {?integer} file.original_w width of the file if an image, in pixels.
 * @param {?integer} file.original_h height of the file if an image, in pixels.
 * @param {?string} file.thumb_360 URL of a 360 pixel wide thumbnail of the
 *     file, if an image.
 * @param {?integer} file.thumb_360_w width of the thumbnail of the 360 pixel
 *     wide thumbnail of the file, if an image.
 * @param {?integer} file.thumb_360_h height of the thumbnail of the 36 pixel
 *     wide thumbnail of the file, if an image.
 * @param {string} url The matrix file mxc.
 * @param {?string} thumbnail_url The matrix thumbnail mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/#m-image
 */
const slackImageToMatrixImage = (file, url: string, thumbnailUrl?: string) => {
    const message = {
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        },
        msgtype: "m.image",
        url,
        // TODO: Define some matrix types
    } as any;

    if (file.original_w) {
        message.info.w = file.original_w;
    }

    if (file.original_h) {
        message.info.h = file.original_h;
    }

    if (thumbnailUrl) {
        message.thumbnail_url = thumbnailUrl;
        message.thumbnail_info = {};
        if (file.thumb_360_w) {
            message.thumbnail_info.w = file.thumb_360_w;
        }
        if (file.thumb_360_h) {
            message.thumbnail_info.h = file.thumb_360_h;
        }
    }
    return message;
};

/**
 * Converts a slack video attachment to a matrix video event.
 *
 * @param file The slack video attachment file object.
 * @param file.size size of the file in bytes.
 * @param file.title alt-text for the file.
 * @param file.mimetype mime-type of the file.
 * @param file.original_w width of the file if an image, in pixels.
 * @param file.original_h height of the file if an image, in pixels.
 * @param url The matrix file mxc.
 * @param thumbnail_url The matrix thumbnail mxc.
 * @return Matrix event content, as per https://matrix.org/docs/spec/client_server/r0.4.0.html#m-video
 */
const slackImageToMatrixVideo = (file, url: string, thumbnailUrl?: string) => {
    const message = {
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        },
        msgtype: "m.video",
        url,
        // TODO: Define some matrix types
    } as any;

    if (file.original_w) {
        message.info.w = file.original_w;
    }

    if (file.original_h) {
        message.info.h = file.original_h;
    }

    if (thumbnailUrl) {
        message.thumbnail_url = thumbnailUrl;
        // Slack don't tell us the thumbnail size for videos. Boo
    }

    return message;
};

/**
 * Converts a slack audio attachment to a matrix audio event.
 *
 * @param {Object} file The slack audio attachment file object.
 * @param {?integer} file.size size of the file in bytes.
 * @param {string} file.title alt-text for the file.
 * @param {string} file.mimetype mime-type of the file.
 * @param {string} url The matrix file mxc.
 * @return {Object} Matrix event content, as per https://matrix.org/docs/spec/client_server/r0.4.0.html#m-audio
 */
const slackImageToMatrixAudio = (file, url: string) => {
    return {
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        },
        msgtype: "m.audio",
        url,
    };
};
/**
 * Converts a slack file upload to a matrix file upload event.
 *
 * @param file The slack file object.
 * @param url The matrix file mxc.
 * @param thumbnail_url The matrix thumbnail mxc.
 * @return Matrix event content, as per https://matrix.org/docs/spec/#m-file
 */
const slackFileToMatrixMessage = (file, url: string, thumbnailUrl?: string) => {
    if (file.mimetype) {
        if (file.mimetype.startsWith("image/")) {
            return slackImageToMatrixImage(file, url, thumbnailUrl);
        } else if (file.mimetype.startsWith("video/")) {
            return slackImageToMatrixVideo(file, url, thumbnailUrl);
        } else if (file.mimetype.startsWith("audio/")) {
            return slackImageToMatrixAudio(file, url);
        }
    }

    return  {
        body: file.title,
        info: {
            mimetype: file.mimetype,
            size: file.size,
        },
        msgtype: "m.file",
        url,
    };
};
