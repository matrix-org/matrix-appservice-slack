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
import { Main } from "./Main";
import { WebClient } from "@slack/web-api";
import { FilesSharedPublicURLResponse, ConversationsInfoResponse } from "./SlackResponses";

const log = Logging.get("BaseSlackHandler");

const CHANNEL_ID_REGEX = /<#(\w+)\|?\w*?>/g;

// (if the message is an emote, the format is <@ID|nick>, but in normal msgs it's just <@ID>
const USER_ID_REGEX = /<@(\w+)\|?\w*?>/g;

export const INTERNAL_ID_LEN = 32;
export const HTTP_CODES = {
    CLIENT_ERROR: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    OK: 200,
    SERVER_ERROR: 500,
};

export interface ISlackMessage {
    channel: string;
    text?: string;
    ts: string;
}

export interface ISlackEvent {
    type: string;
    channel: string;
    ts: string;
    bot_id?: string;
    team_domain?: string;
    user_id: string;
}

export interface ISlackEventMessageAttachment {
    fallback: string;
}

export interface ISlackMessageEvent extends ISlackEvent {
    team_domain?: string;
    user?: string;
    user_id: string;
    inviter?: string;
    item?: {
        type: string;
        channel: string;
        ts: string;
    };
    subtype?: string;
    bot_id?: string;
    text?: string;
    deleted_ts?: string;
    // For comments
    comment?: {
        user: string;
    };
    attachments?: ISlackEventMessageAttachment[];
    // For message_changed
    message?: ISlackMessageEvent;
    previous_message?: ISlackMessageEvent;
    file?: ISlackFile;
    files?: ISlackFile[];
    /**
     * PSA: `event_ts` refers to the time an event was acted upon,
     * and `ts` is the events timestamp itself. Use `event_ts` over `ts`
     * when handling.
     */
    event_ts?: string;
    thread_ts?: string;
}

export interface ISlackFile {
    name?: string;
    thumb_360?: string;
    thumb_video?: string;
    filetype?: string;
    mode?: string;
    title: string;
    mimetype: string;
    permalink_public?: string;
    id: string;
    url_private?: string;
    public_url_shared?: string;
    permalink?: string;
    size: number;
    shares?: {
        public?: {
            [channelId: string]: {
                ts: string;
            }
        },
        private?: {
            [channelId: string]: {
                ts: string;
            }[]
        }
    }
}

export interface ISlackUser {
    id: string;
    deleted: boolean;
    name: string;
    profile?: {
        display_name?: string;
        real_name?: string;
        image_original?: string;
        image_1024?: string;
        image_512?: string;
        image_192?: string;
        image_72?: string;
        image_48?: string;
        bot_id?: string;
        avatar_hash?: string;
    };
}

export abstract class BaseSlackHandler {
    constructor(protected main: Main) { }

    public async getSlackRoomNameFromID(channel: string, client: WebClient): Promise<string> {
        try {
            const response = (await client.conversations.info({ channel })) as ConversationsInfoResponse;
            if (response && response.channel && response.channel.name) {
                log.info(`conversations.info: ${channel} mapped to ${response.channel.name}`);
                return response.channel.name;
            }
            log.info("conversations.info returned no result for " + channel);
        } catch (err) {
            log.error("Caught error handling conversations.info:" + err);
        }
        return channel;
    }

    public async doChannelUserReplacements(msg: ISlackMessage, text: string|undefined, slackClient: WebClient): Promise<string|undefined> {
        if (text === undefined) {
            return;
        }
        text = await this.replaceChannelIdsWithNames(msg, text, slackClient);
        return await this.replaceUserIdsWithNames(msg, text);
    }

    public async replaceChannelIdsWithNames(message: ISlackMessage, text: string, slackClient: WebClient): Promise<string> {
        let match: RegExpExecArray | null = null;
        while ((match = CHANNEL_ID_REGEX.exec(text)) !== null) {
            // foreach channelId, pull out the ID
            // (if this is an emote msg, the format is <#ID|name>, but in normal msgs it's just <#ID>
            const id = match[1];

            // Lookup the room in the store.
            let room = this.main.rooms.getBySlackChannelId(id);

            // If we bridge the room, attempt to look up its canonical alias.
            if (room !== undefined) {
                const client = this.main.botIntent.getClient();
                let canonicalAlias: string|undefined;
                try {
                    const canonical = await client.getStateEvent(room.MatrixRoomId, "m.room.canonical_alias");
                    canonicalAlias = canonical?.alias;
                } catch (ex) {
                    // If we can't find a canonical alias fall back to just the Slack channel name.
                    log.debug(`Room ${room.MatrixRoomId} does not have a canonical alias`, ex);
                }
                if (canonicalAlias) {
                    text = text.slice(0, match.index) + canonicalAlias + text.slice(match.index + match[0].length);
                } else {
                    room = undefined;
                }
            }

            // If we can't match the room then we just put the Slack name
            if (room === undefined) {
                const name = await this.getSlackRoomNameFromID(id, slackClient);
                text = text.slice(0, match.index) + `#${name}` + text.slice(match.index + match[0].length);
            }
        }
        return text;
    }

    public async replaceUserIdsWithNames(message: ISlackMessage, text: string): Promise<string> {
        const teamDomain = await this.main.getTeamDomainForMessage(message as any);

        if (!teamDomain) {
            log.warn(`Cannot replace user ids with names for ${message.ts}. Unable to determine the teamDomain.`);
            return text;
        }

        let match: RegExpExecArray|null = null;
        while ((match = USER_ID_REGEX.exec(text)) !== null) {
            // foreach userId, pull out the ID
            // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
            const id = match[1];

            let displayName = "";
            const userId = this.main.ghostStore.getUserId(id, teamDomain);

            const users = await this.main.datastore.getUser(userId);

            if (!users) {
                log.warn("Mentioned user not in store. Looking up display name from slack.");
                // if the user is not in the store then we look up the displayname
                displayName = await this.main.ghostStore.getNullGhostDisplayName(message.channel, id);
                // If the user is not in the room, we can't pills them, we have to just plain text mention them.
                text = text.slice(0, match.index) + displayName + text.slice(match.index + match[0].length);
            } else {
                displayName = users.display_name || userId;
                text = text.slice(0, match.index) + `<https://matrix.to/#/${userId}|${displayName}>` + text.slice(match.index + match[0].length);
            }
        }
        return text;
    }

    /**
     * Enables public sharing on the given file object. then fetches its content.
     *
     * @param {Object} file A Slack 'message.file' data object
     * @param {string} token A Slack API token that has 'files:write:user' scope
     * @return {Promise<Object>} A Promise of the updated Slack file data object
     * @throws if the Slack request fails or the response didn't contain `file.permalink_public`
     */
    public async enablePublicSharing(file: ISlackFile, slackClient: WebClient): Promise<ISlackFile> {
        if (file.public_url_shared) { return file; }

        const response = (await slackClient.files.sharedPublicURL({ file: file.id })) as FilesSharedPublicURLResponse;
        if (!response || !response.file || !response.file.permalink_public) {
            log.warn("Could not find sharedPublicURL: " + JSON.stringify(response));
            throw Error("files.sharedPublicURL didn't return a shareable url");
        }
        return response.file;
    }
}
