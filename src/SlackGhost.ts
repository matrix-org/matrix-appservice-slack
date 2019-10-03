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

import { Main, METRIC_SENT_MESSAGES } from "./Main";
import { Logging, Intent } from "matrix-appservice-bridge";
import * as rp from "request-promise-native";
import * as Slackdown from "Slackdown";
import { BridgedRoom } from "./BridgedRoom";
import { ISlackUser } from "./BaseSlackHandler";
import { WebClient } from "@slack/web-api";
import { BotsInfoResponse, UsersInfoResponse } from "./SlackResponses";
import { UserEntry } from "./datastore/Models";

const log = Logging.get("SlackGhost");

// How long in milliseconds to cache user info lookups.
const USER_CACHE_TIMEOUT = 10 * 60 * 1000;  // 10 minutes

interface IMatrixReplyEvent {
    sender: string;
    event_id: string;
    content: {
        body: string;
        formatted_body?: string;
    };
}

export class SlackGhost {

    public get aTime() {
        return this.atime;
    }

    public static fromEntry(main: Main, entry: UserEntry, intent: Intent) {
        return new SlackGhost(
            main,
            entry.slack_id,
            entry.team_id,
            entry.id,
            intent,
            entry.display_name,
            entry.avatar_url,
        );
    }
    private atime?: number;
    private userInfoCache?: ISlackUser;
    private typingInRooms: Set<string> = new Set();
    private userInfoLoading?: Promise<UsersInfoResponse>;
    private updateInProgress: boolean = false;
    constructor(
        private main: Main,
        public readonly slackId: string,
        public readonly teamId: string|undefined,
        public readonly userId: string,
        public readonly intent?: Intent,
        private displayName?: string,
        private avatarUrl?: string) {
        this.slackId = slackId.toUpperCase();
        if (teamId) {
            this.teamId = teamId.toUpperCase();
        }
    }

    public toEntry(): UserEntry {
        return {
            avatar_url: this.avatarUrl!,
            display_name: this.displayName!,
            id: this.userId!,
            slack_id: this.slackId,
            team_id: this.teamId,
        };
    }

    public async update(message: {user_id?: string, user?: string}, room: BridgedRoom) {
        const user = (message.user_id || message.user);
        if (this.updateInProgress) {
            log.debug(`Not updating ${user}: Update in progress.`);
            return;
        }
        log.info(`Updating user information for ${user}`);
        const updateStartTime = Date.now();
        this.updateInProgress = true;
        await Promise.all([
            this.updateDisplayname(message, room).catch((e) => {
                log.error("Failed to update ghost displayname:", e);
            }),
            this.updateAvatar(message, room).catch((e) => {
                log.error("Failed to update ghost avatar:", e);
            }),
        ]);
        log.debug(`Completed update for ${user} in ${Date.now() - updateStartTime}ms`);
        this.updateInProgress = false;
    }

    public async getDisplayname(client: WebClient) {
        const user = await this.lookupUserInfo(client);
        if (user && user.profile) {
            return user.profile.display_name || user.profile.real_name;
        }
    }

    public async updateDisplayname(message: {username?: string, user_name?: string, bot_id?: string, user_id?: string},
                                   room: BridgedRoom) {
        if (!room.SlackClient) {
            return;
        }

        let displayName = message.username || message.user_name;

        if (message.bot_id) {
            displayName = await this.getBotName(message.bot_id, room.SlackClient);
        } else if (message.user_id) {
            displayName = await this.getDisplayname(room.SlackClient);
        }

        if (!displayName || this.displayName === displayName) {
            return; // Nothing to do.
        }

        await this.intent.setDisplayName(displayName);
        this.displayName = displayName;
        return this.main.datastore.upsertUser(this);
    }

    public async lookupAvatarUrl(client: WebClient) {
        const user = await this.lookupUserInfo(client);
        if (!user || !user.profile) { return; }
        const profile = user.profile;

        // Pick the original image if we can, otherwise pick the largest image
        // that is defined
        return profile.image_original ||
            profile.image_1024 || profile.image_512 || profile.image_192 ||
            profile.image_72 || profile.image_48;
    }

    public async getBotName(botId: string, client: WebClient) {
        const response = (await client.bots.info({ bot: botId})) as BotsInfoResponse;
        if (!response.ok || !response.bot.name) {
            log.error("Failed to get bot name", response.error);
            return;
        }
        return response.bot.name;
    }

    public async getBotAvatarUrl(botId: string, client: WebClient) {
        const response = (await client.bots.info({ bot: botId})) as BotsInfoResponse;
        if (!response.ok) {
            log.error("Failed to get bot name", response.error);
            return;
        }
        const icons = response.bot.icons;
        const icon = icons.image_original || icons.image_1024 || icons.image_512 ||
            icons.image_192 || icons.image_72 || icons.image_48;
        if (!icon) {
            log.error("No suitable icon for bot");
            return;
        }
        return icon;
    }

    public async lookupUserInfo(client: WebClient) {
        if (this.userInfoCache) {
            log.debug("Using cached userInfo for", this.slackId);
            return this.userInfoCache;
        }
        if (this.userInfoLoading) {
            const existingReq = await this.userInfoLoading;
            if (existingReq.user) {
                return existingReq.user;
            }
            return;
        }
        log.debug("Using fresh userInfo for", this.slackId);

        this.userInfoLoading = client.users.info({user: this.slackId}) as Promise<UsersInfoResponse>;
        const response = await this.userInfoLoading!;
        if (!response.user || !response.user.profile) {
            log.error("Failed to get user profile", response);
            return;
        }
        this.userInfoCache = response.user;
        setTimeout(() => this.userInfoCache = undefined, USER_CACHE_TIMEOUT);
        this.userInfoLoading = undefined;
        return response.user!;
    }

    public async updateAvatar(message: {bot_id?: string, user_id?: string}, room: BridgedRoom) {
        if (!room.SlackClient) {
            return;
        }
        let avatarUrl;
        if (message.bot_id) {
            avatarUrl = await this.getBotAvatarUrl(message.bot_id, room.SlackClient);
        } else if (message.user_id) {
            avatarUrl = await this.lookupAvatarUrl(room.SlackClient);
        } else {
            return;
        }

        if (this.avatarUrl === avatarUrl) {
            return;
        }

        const match = avatarUrl.match(/\/([^\/]+)$/);
        if (!match || !match[1]) {
            return;
        }

        const title = match[1];

        const response = await rp({
            encoding: null,
            resolveWithFullResponse: true,
            uri: avatarUrl,
        });
        const contentUri = await this.uploadContent({
            mimetype: response.headers["content-type"],
            title,
        }, response.body);
        await this.intent.setAvatarUrl(contentUri);
        this.avatarUrl = avatarUrl;
        await this.main.datastore.upsertUser(this);
    }

    public prepareBody(body: string) {
        // TODO: This is fixing plaintext mentions, but should be refactored.
        // See https://github.com/matrix-org/matrix-appservice-slack/issues/110
        return body.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
    }

    public prepareFormattedBody(body: string) {
        return Slackdown.parse(body);
    }

    public async sendText(roomId: string, text: string, slackRoomID: string, slackEventTS: string, extra: {} = {}) {
        // TODO: Slack's markdown is their own thing that isn't really markdown,
        // but the only parser we have for it is slackdown. However, Matrix expects
        // a variant of markdown that is in the realm of sanity. Currently text
        // will be slack's markdown until we've got a slack -> markdown parser.

        // TODO: This is fixing plaintext mentions, but should be refactored.
        // https://github.com/matrix-org/matrix-appservice-slack/issues/110
        const body = text.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
        const content = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: Slackdown.parse(text),
            msgtype: "m.text",
            ...extra,
        };
        return this.sendMessage(roomId, content, slackRoomID, slackEventTS);
    }

    public async sendMessage(roomId: string, msg: {}, slackRoomId: string, slackEventTs: string) {
        const matrixEvent = await this.intent.sendMessage(roomId, msg);
        this.main.incCounter(METRIC_SENT_MESSAGES, {side: "matrix"});

        await this.main.datastore.upsertEvent(
            roomId,
            matrixEvent.event_id,
            slackRoomId,
            slackEventTs,
        );

        return matrixEvent;
    }

    public async sendReaction(roomId: string, eventId: string, key: string,
                              slackRoomId: string, slackEventTs: string) {
        const content = {
            "m.relates_to": {
                event_id: eventId,
                key,
                rel_type: "m.annotation",
            },
        };

        const matrixEvent = await this.intent.sendEvent(roomId, "m.reaction", content);

        // Add this event to the eventStore
        await this.main.datastore.upsertEvent(roomId, matrixEvent.event_id, slackRoomId, slackEventTs);

        return matrixEvent;
    }

    public async sendWithReply(roomId: string, text: string, slackRoomId: string,
                               slackEventTs: string, replyEvent: IMatrixReplyEvent) {
        const fallbackHtml = this.getFallbackHtml(roomId, replyEvent);
        const fallbackText = this.getFallbackText(replyEvent);

        const content = {
            "m.relates_to": {
                "m.in_reply_to": {
                    event_id: replyEvent.event_id,
                },
            },
            "msgtype": "m.text", // for those who just want to send the reply as-is
            "body": `${fallbackText}\n\n${this.prepareBody(text)}`,
            "format": "org.matrix.custom.html",
            "formatted_body": fallbackHtml + this.prepareFormattedBody(text),
        };
        return await this.sendMessage(roomId, content, slackRoomId, slackEventTs);
    }

    public async sendTyping(roomId: string): Promise<void> {
        // This lasts for 20000 - See http://matrix-org.github.io/matrix-js-sdk/1.2.0/client.js.html#line2031
        this.typingInRooms.add(roomId);
        await this.intent.sendTyping(roomId, true);
    }

    public async cancelTyping(roomId: string): Promise<void> {
        if (this.typingInRooms.has(roomId)) {
            // We aren't checking for timeouts here, but typing
            // calls aren't expensive if they no-op.
            this.typingInRooms.delete(roomId);
            await this.intent.sendTyping(roomId, false);
        }
    }

    public async uploadContentFromURI(file: {mimetype: string, title: string}, uri: string, slackAccessToken: string)
    : Promise<string> {
        try {
            const response = await rp({
                encoding: null, // Because we expect a binary
                headers: {
                    Authorization: `Bearer ${slackAccessToken}`,
                },
                uri,
            });
            return await this.uploadContent(file, response as Buffer);
        } catch (reason) {
            log.error("Failed to upload content:\n%s", reason);
            throw reason;
        }
    }

    public async uploadContent(file: {mimetype: string, title: string}, buffer: Buffer): Promise<string> {
        const contentUri = await this.intent.getClient().uploadContent(buffer, {
            name: file.title,
            type: file.mimetype,
            rawResponse: false,
            onlyContentUri: true,
        });
        log.debug("Media uploaded to " + contentUri);
        return contentUri;
    }

    public bumpATime() {
        this.atime = Date.now() / 1000;
    }

    public getFallbackHtml(roomId: string, replyEvent: IMatrixReplyEvent) {
        const originalBody = (replyEvent.content ? replyEvent.content.body : "") || "";
        let originalHtml = (replyEvent.content ? replyEvent.content.formatted_body : "") || null;
        if (originalHtml === null) {
            originalHtml = originalBody;
        }
        return "<mx-reply><blockquote>"
              + `<a href="https://matrix.to/#/${roomId}/${replyEvent.event_id}">In reply to</a>`
              + `<a href="https://matrix.to/#/${replyEvent.sender}">${replyEvent.sender}</a>`
              + `<br />${originalHtml}`
              + "</blockquote></mx-reply>";
    }

    public getFallbackText(replyEvent: IMatrixReplyEvent) {
        const originalBody = (replyEvent.content ? replyEvent.content.body : "") || "";
        return `> <${replyEvent.sender}> ${originalBody.split("\n").join("\n> ")}`;
    }
}
