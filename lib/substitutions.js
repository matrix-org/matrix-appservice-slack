"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const matrix_appservice_bridge_1 = require("matrix-appservice-bridge");
const emoji = require("node-emoji");
const log = matrix_appservice_bridge_1.Logging.get("substitutions");
function onMissingEmoji(name) {
    return `:${name}:`;
}
exports.onMissingEmoji = onMissingEmoji;
;
class Subsitutions {
    constructor() {
        // slack -> matrix substitutions are performed top -> bottom
        // matrix -> slack substitutions are performed bottom -> top
        //
        // The ordering here matters because some characters are present in both the
        // "old" and "new" patterns, and we may end up over- or under-escaping things,
        // or in an escaping loop, if things aren't properly ordered.
        this.pairs = [
            { slack: "&lt;", matrix: "<" },
            { slack: "&gt;", matrix: ">" },
            // &amp; must be after all replacements involving &s.
            { slack: "&amp;", matrix: "&" }
        ];
    }
    /**
     * Performs any escaping, unescaping, or substituting required to make the text
     * of a Slack message appear like the text of a Matrix message.
     *
     * @param body the text, in Slack's format.
     * @param file options slack file object
     */
    slackToMatrix(body, file) {
        log.debug("running substitutions on ", body);
        for (const pair of this.pairs) {
            body.replace(new RegExp(`/${pair.slack}/g`), pair.matrix);
        }
        body = body.replace("<!channel>", "@room");
        // if we have a file, attempt to get the direct link to the file
        if (file && file.public_url_shared) {
            const url = this.getSlackFileUrl(file);
            body = url ? body.replace(file.permalink, url) : body;
        }
        body = emoji.emojify(body, onMissingEmoji);
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
    async matrixToSlack(event, main, teamId) {
        let body = event.content.body;
        body = body.replace(/<((https?:\/\/)?[^>]+?)>/g, '$1');
        for (const pair of this.pairs) {
            body.replace(new RegExp(`/${pair.matrix}/g`), pair.slack);
        }
        // emotes in slack are just italicised
        if (event.content.msgtype === "m.emote") {
            body = `_${body}_`;
        }
        // replace riot "pill" behavior to "@" mention for slack users
        const html_string = event.content.formatted_body;
        if (undefined != html_string) {
            const regex = new RegExp('<a href="https://matrix.to/#/#' +
                '([^"]+)">([^<]+)</a>', "g");
            let match = regex.exec(html_string);
            while (match != null) {
                const alias = match[2];
                const client = main.botIntent.getClient();
                const room_id = await client.getRoomIdForAlias(alias);
                const room = main.getRoomByMatrixRoomId(room_id['room_id']);
                if (room !== undefined && room.SlackTeamId === teamId) {
                    body = body.replace(alias, "<#" + room.SlackChannelId + ">");
                }
                match = regex.exec(html_string);
            }
        }
        // convert @room to @channel
        body = body.replace("@room", "@channel");
        // Strip out any language specifier on the code tags, as they are not supported by slack.
        body = body.replace(/```[\w*]+\n/g, "```\n");
        // Note: This slower plainTextSlackMentions call is only used if there is not a pill in the message,
        // meaning if we can we use the much simpler pill subs rather than this.
        const modifiedBody = await plainTextSlackMentions(main, body, event.room_id);
        const ret = {
            username: event.user_id,
            text: modifiedBody,
            link_names: 1 //This no longer works for nicks but is needed to make @channel work.
        };
        if (event.content.msgtype === "m.image" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            delete ret.text;
            ret.attachments = [{
                    fallback: modifiedBody,
                    image_url: url
                }];
        }
        else if (event.content.msgtype === "m.file" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            ret.text = "<" + url + "|" + modifiedBody + ">";
        }
        return ret;
    }
    htmlEscape(s) {
        return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    /**
     * Get a mapping of the nicknames of all Slack Ghosts in the room to their slack user ids.
     *
     * @param {String} room_id The room id to make the maps for.
     * @return {Promise} A mapping of display name to slack user id.
     */
    async getDisplayMap(main, roomId) {
        const displaymap = {};
        const store = main.userStore;
        const users = await main.listGhostUsers(roomId);
        const storeUsers = await Promise.all(users.map((id) => store.select({ id })));
        storeUsers.forEach(user => {
            if (user && user[0]) {
                displaymap[user[0].display_name] = user[0].id.split("_")[2].split(":")[0];
            }
        });
        return displaymap;
    }
    /**
     * Construct a mapping of the first words of all the display names to
     * an array of objects which map full display names to their slack
     * user ids.
     * i.e. {"bob": [{"bob": "U123123"}, {"bob smith": "U2891283"}]}
     *
     * @param {Object} displaymap A mapping of display names to slack user ids.
     * @return {Object} A mapping of first words of display names.
     */
    makeFirstWordMap(displaymap) {
        const displaynames = Object.keys(displaymap);
        const firstwords = {};
        for (const dispname of displaynames) {
            const firstword = dispname.split(" ")[0];
            const amap = {};
            amap[dispname] = displaymap[dispname];
            if (firstwords.hasOwnProperty(firstword)) {
                firstwords[firstword].push(amap);
            }
            else {
                firstwords[firstword] = [amap];
            }
        }
        return firstwords;
    }
    makeDiff(prev, curr) {
        let i;
        for (i = 0; i < curr.length && i < prev.length; i++) {
            if (curr.charAt(i) != prev.charAt(i))
                break;
        }
        // retreat to the start of a word
        while (i > 0 && /\S/.test(curr.charAt(i - 1)))
            i--;
        let prefixLen = i;
        for (i = 0; i < curr.length && i < prev.length; i++) {
            if (rcharAt(curr, i) != rcharAt(prev, i))
                break;
        }
        // advance to the end of a word
        while (i > 0 && /\S/.test(rcharAt(curr, i - 1)))
            i--;
        let suffixLen = i;
        // Extract the common prefix and suffix strings themselves and
        //   mutate the prev/curr strings to only contain the differing
        //   middle region
        let prefix = curr.slice(0, prefixLen);
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
        if (before != prefix) {
            before = "... " + before;
        }
        let after = firstWord(suffix);
        if (after != suffix) {
            after = after + " ...";
        }
        // return {prev: prev,
        //         curr: curr,
        //         before: before,
        //         after: after};
        return { prev, curr, before, after };
    }
    getSlackFileUrl(file) {
        const pub_secret = file.permalink_public.match(/https?:\/\/slack-files.com\/[^-]*-[^-]*-(.*)/);
        if (!pub_secret) {
            throw Error("Could not determine pub_secret");
        }
        // try to get direct link to the file
        if (pub_secret !== undefined && pub_secret.length > 0) {
            return file.url_private + "?pub_secret=" + pub_secret[1];
        }
    }
}
const subsitutions = new Subsitutions();
exports.default = subsitutions;
/**
 * Do string replacement on a message given the display map.
 *
 * @param {String} string The string to perform replacements on.
 * @param {Object} displaymap A mapping of display names to slack user ids.
 * @return {String} The string with replacements performed.
 */
function replacementFromDisplayMap(string, displaymap) {
    const firstwords = subsitutions.makeFirstWordMap(displaymap);
    // Now parse the message to find the intersection of every word in the
    // message with every first word of all nicks.
    const match_words = new Set(Object.keys(firstwords));
    const string_words = new Set(string.split(" "));
    const matches = [...string_words].filter(x => match_words.has(x));
    if (matches && matches.length) {
        for (const firstword of matches) {
            if (firstwords.hasOwnProperty(firstword)) {
                const nicks = firstwords[firstword];
                if (nicks.length === 1) {
                    string = string.replace(firstword, "<@" + nicks[0][firstword] + ">");
                }
                else {
                    // Sort the displaynames by longest string first, and then match them from longest to shortest.
                    // This can match multiple times if there is more than one mention in the message
                    const displaynames = nicks.map(x => Object.keys(x)[0]);
                    displaynames.sort((x, y) => y.length - x.length);
                    for (const displayname of displaynames) {
                        if (string.includes(displayname)) {
                            string = string.replace(displayname, "<@" + displaymap[displayname] + ">");
                        }
                    }
                }
            }
        }
    }
    return string;
}
/**
 * Replace plain text form of @displayname mentions with the slack mention syntax.
 *
 * @param {Main} main the toplevel main instance
 * @param {String} string The string to perform replacements on.
 * @param {String} room_id The room the message was sent in.
 * @return {String} The string with replacements performed.
 */
async function plainTextSlackMentions(main, s, room_id) {
    return replacementFromDisplayMap(s, await subsitutions.getDisplayMap(main, room_id));
}
// These functions are copied and modified from the Gitter AS
// idx counts backwards from the end of the string; 0 is final character
function rcharAt(s, idx) {
    return s.charAt(s.length - 1 - idx);
}
function firstWord(s) {
    let groups = s.match(/^\s*\S+/);
    return groups ? groups[0] : "";
}
function finalWord(s) {
    let groups = s.match(/\S+\s*$/);
    return groups ? groups[0] : "";
}
