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
import * as emoji from "node-emoji";
import { Main } from "./Main";
import { ISlackFile } from "./BaseSlackHandler";
import { UserEntry } from "./datastore/Models";
import { ConversationsMembersResponse } from "./SlackResponses";
import * as escapeStringRegexp from "escape-string-regexp";

const log = Logging.get("substitutions");

const ATTACHMENT_TYPES = ["m.audio", "m.video", "m.file"];
const PILL_REGEX = /<a href="https:\/\/matrix\.to\/#\/(#|@|\+)([^"]+)">([^<]+)<\/a>/g;

/**
 * Will return the emoji's name within ':'.
 * @param name The emoji's name.
 */
export function getFallbackForMissingEmoji(name): string {
    return `:${name}:`;
}

interface IDisplayMap {
    [name: string]: string;
}

interface PillItem {
    id: string;
    text: string;
}

export interface ISlackToMatrixResult {
    link_names: boolean;  // This no longer works for nicks but is needed to make @channel work.
    text?: string;
    username: string;
    attachments?: [{
        fallback: string,
        image_url: string,
    }];
}

class Substitutions {

    /**
     * Performs any escaping, unescaping, or substituting required to make the text
     * of a Slack message appear like the text of a Matrix message.
     *
     * @param body the text, in Slack's format.
     * @param file options slack file object
     */
    public slackToMatrix(body: string, file?: ISlackFile): string {
        log.debug("running substitutions on ", body);
        body = this.htmlUnescape(body);
        body = body.replace("<!channel>", "@room");
        body = body.replace("<!here>", "@room");
        body = body.replace("<!everyone>", "@room");

        // if we have a file, attempt to get the direct link to the file
        if (file && file.public_url_shared) {
            const url = this.getSlackFileUrl({
                permalink_public: file.permalink_public!,
                url_private: file.url_private!,
            });
            body = url ? body.replace(file.permalink!, url) : body;
        }

        body = emoji.emojify(body, getFallbackForMissingEmoji);

        return body;
    }

    /**
     * Performs any escaping, unescaping, or substituting required to make the text
     * of a Matrix message appear like the text of a Slack message.
     *
     * @param event the Matrix event.
     * @param main the toplevel main instance
     * @return An object which can be posted as JSON to the Slack API.
     */
    // tslint:disable-next-line: no-any
    public async matrixToSlack(event: any, main: Main, teamId: string): Promise<ISlackToMatrixResult|null> {
        if (!event || !event.content || !event.sender) {
            return null;
        }
        const msgType = event.content.msgtype || "m.text";
        const isAttachment = ATTACHMENT_TYPES.includes(msgType);
        let body: string = event.content.body;
        if ((typeof(body) !== "string" || body.length < 1) && !isAttachment) {
            return null;
        }

        // Replace markdown urls with plain urls to make them match.
        body = body.replace(/!?\[.*\]\((.+)\)/gm, "$1");

        if (isAttachment) {
            // If it's an attachment, we can allow the body.
            body = typeof(body) === "string" ? body : "";
        }
        body = this.htmlEscape(body);

        // emotes in slack are just italicised
        if (msgType === "m.emote") {
            body = `_${body}_`;
        }

        // replace riot "pill" behavior to "@" mention for slack users
        const format = event.content.format || "org.matrix.custom.html";
        const htmlString: string|undefined = event.content.formatted_body;
        let messageHadPills = false;
        if (htmlString && format === "org.matrix.custom.html") {
            const mentions = this.pillsToItems(htmlString);
            messageHadPills = (mentions.aliases.concat(mentions.communities, mentions.users).length > 0);
            const client = main.botIntent.getClient();
            for (const alias of mentions.aliases) {
                if (!body.includes(alias.text)) {
                    // Do not process an item we have no way to replace.
                    continue;
                }
                try {
                    const roomIdResponse = await client.getRoomIdForAlias(alias.id);
                    const room = main.rooms.getByMatrixRoomId(roomIdResponse.room_id);
                    if (room) {
                        // aliases are faily unique in form, so we can replace these easily enough
                        const aliasRegex = new RegExp(escapeStringRegexp(alias.text), "g");
                        body = body.replace(aliasRegex, `<#${room.SlackChannelId!}>`);
                    }
                } catch (ex) {
                    // We failed the lookup so just continue
                    continue;
                }
            }
            for (const user of mentions.users) {
                // This also checks if the user is a slack user.
                const ghost = await main.getExistingSlackGhost(user.id);
                if (ghost && ghost.slackId) {
                    // We need to replace the user's displayname with the slack mention, but we need to
                    // ensure to do it only on whitespace wrapped strings.
                    const userRegex = new RegExp(`(?<=^|\\s)${escapeStringRegexp(user.text)}(?=$|\\s)`, "g");
                    body = body.replace(userRegex, `<@${ghost.slackId}>`);
                }
            }
            // Nothing to be done on communities yet.
        }

        // convert @room to @channel
        body = body.replace("@room", "@channel");

        // Strip out any language specifier on the code tags, as they are not supported by slack.
        // TODO: https://github.com/matrix-org/matrix-appservice-slack/issues/279
        body = body.replace(/```[\w*]+\n/g, "```\n");

        if (!messageHadPills && teamId) {
            // Note: This slower plainTextSlackMentions call is only used if there is not a pill in the message,
            // meaning if we can we use the much simpler pill subs rather than this.
            body = await plainTextSlackMentions(main, body, teamId);
        }

        if (!isAttachment) {
            return {
                link_names: true, // This no longer works for nicks but is needed to make @channel work.
                text: body,
                username: event.sender,
            };
        }
        if (!event.content.url || !event.content.url.startsWith("mxc://")) {
            // Url is missing or wrong. We don't want to send any messages
            // in this case.
            return null;
        }
        const url = main.getUrlForMxc(event.content.url);
        if (msgType === "m.image") {
            // Images are special, we can send those as attachments.
            return {
                link_names: false,
                username: event.sender,
                attachments: [
                    {
                        fallback: body,
                        image_url: url,
                    },
                ],
            };
        }
        // Send all other types as links
        return {
            link_names: true,
            text: `<${url}|${body}>`,
            username: event.sender,
        };
    }

    /**
     * This will parse a message and return the "pills" found within.
     * @param htmlBody HTML content of a Matrix message
     */
    private pillsToItems(htmlBody: string) {
        const ret: { users: PillItem[], aliases: PillItem[], communities: PillItem[]} = {
            users: [],
            aliases: [],
            communities: [],
        };
        const MAX_ITERATIONS = 15;
        let res: RegExpExecArray|null = PILL_REGEX.exec(htmlBody);
        for (let i = 0; i < MAX_ITERATIONS && res != null; i++) {
            const sigil = res[1];
            const item: PillItem = {
                id: res[1] + res[2],
                text: res[3],
            };
            if (sigil === "@") {
                ret.users.push(item);
            } else if (sigil === "#") {
                ret.aliases.push(item);
            } else if (sigil === "+") {
                ret.communities.push(item);
            }
            res = PILL_REGEX.exec(htmlBody);
        }
        return ret;
    }

    /**
     * Replace &, < and > in a string with their HTML escaped counterparts.
     */
    public htmlEscape(s: string): string {
        return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /**
     * Replace &lt;, &gt; and &amp; in a string with their real counterparts.
     */
    public htmlUnescape(s: string): string {
        return s.replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&");
    }

    public makeDiff(prev: string, curr: string): { prev: string, curr: string, before: string, after: string} {
        let i;
        for (i = 0; i < curr.length && i < prev.length; i++) {
            if (curr.charAt(i) !== prev.charAt(i)) { break; }
        }
        // retreat to the start of a word
        while (i > 0 && /\S/.test(curr.charAt(i - 1))) { i--; }

        const prefixLen = i;

        for (i = 0; i < curr.length && i < prev.length; i++) {
            if (rcharAt(curr, i) !== rcharAt(prev, i)) { break; }
        }
        // advance to the end of a word
        while (i > 0 && /\S/.test(rcharAt(curr, i - 1))) { i--; }

        const suffixLen = i;

        // Extract the common prefix and suffix strings themselves and
        //   mutate the prev/curr strings to only contain the differing
        //   middle region
        const prefix = curr.slice(0, prefixLen);
        curr = curr.slice(prefixLen);
        prev = prev.slice(prefixLen);

        let suffix = "";
        if (suffixLen > 0) {
            suffix = curr.slice(-suffixLen);
            curr = curr.slice(0, -suffixLen);
            prev = prev.slice(0, -suffixLen);
        }

        // At this point, we have four strings; the common prefix and
        //   suffix, and the edited middle part. To display it nicely as a
        //   matrix message we'll use the final word of the prefix and the
        //   first word of the suffix as "context" for a customly-formatted
        //   message.

        let before = finalWord(prefix);
        if (before !== prefix) { before = "... " + before; }

        let after = firstWord(suffix);
        if (after !== suffix) { after = after + " ..."; }

        return {prev, curr, before, after};
    }

    public getSlackFileUrl(file: {
        permalink_public: string,
        url_private: string,
    }): string|undefined {
        const pubSecret = file.permalink_public.match(/https?:\/\/slack-files.com\/[^-]*-[^-]*-(.*)/);
        if (!pubSecret) {
            throw Error("Could not determine pub_secret");
        }
        // try to get direct link to the file
        if (pubSecret && pubSecret.length > 0) {
            return `${file.url_private}?pub_secret=${pubSecret[1]}`;
        }
    }
}

const substitutions = new Substitutions();

export default substitutions;

/**
 * Replace plain text form of @displayname mentions with the slack mention syntax.
 *
 * @param {Main} main the toplevel main instance
 * @param {String} string The string to perform replacements on.
 * @param {String} room_id The room the message was sent in.
 * @return {String} The string with replacements performed.
 */
async function plainTextSlackMentions(main: Main, body: string, teamId: string) {
    const users = await main.datastore.getAllUsersForTeam(teamId);
    for (const user of users) {
        const displayName = `@${user.display_name}`;
        if (body.includes(displayName)) {
            const userRegex = new RegExp(`${escapeStringRegexp(displayName)}(?=$|\s)`, "g");
            body = body.replace(userRegex, `<@${user.slack_id}>`);
        }
    }
    return body;
}

// These functions are copied and modified from the Gitter AS
// idx counts backwards from the end of the string; 0 is final character
function rcharAt(s: string, idx: number) {
    return s.charAt(s.length - 1 - idx);
}

/**
 * Gets the first word in a given string.
 */
function firstWord(s: string): string {
    const groups = s.match(/^\s*\S+/);
    return groups ? groups[0] : "";
}

/**
 * Gets the final word in a given string.
 */
function finalWord(s: string): string {
    const groups = s.match(/\S+\s*$/);
    return groups ? groups[0] : "";
}
