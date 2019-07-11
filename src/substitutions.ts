import { Logging } from "matrix-appservice-bridge";
import * as emoji from "node-emoji";
import { Main } from "./Main";
import { ISlackFile } from "./BaseSlackHandler";

const log = Logging.get("substitutions");

export function onMissingEmoji(name) {
    return `:${name}:`;
}

class Substitutions {
    // Ordered
    private pairs: {slack: string, matrix: string}[];
    constructor() {
        // slack -> matrix substitutions are performed top -> bottom
        // matrix -> slack substitutions are performed bottom -> top
        //
        // The ordering here matters because some characters are present in both the
        // "old" and "new" patterns, and we may end up over- or under-escaping things,
        // or in an escaping loop, if things aren't properly ordered.
        this.pairs = [
            {slack: "&lt;", matrix: "<"},
            {slack: "&gt;", matrix: ">"},
            // &amp; must be after all replacements involving &s.
            {slack: "&amp;", matrix: "&"},
        ];
    }

    /**
     * Performs any escaping, unescaping, or substituting required to make the text
     * of a Slack message appear like the text of a Matrix message.
     *
     * @param body the text, in Slack's format.
     * @param file options slack file object
     */
    public slackToMatrix(body: string, file?: ISlackFile): string {
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
// tslint:disable-next-line: no-any
    public async matrixToSlack(event: any, main: Main, teamId: string) {
        let body = event.content.body;
        body = body.replace(/<((https?:\/\/)?[^>]+?)>/g, "$1");

        for (const pair of this.pairs) {
            body.replace(new RegExp(`/${pair.matrix}/g`), pair.slack);
        }
        // emotes in slack are just italicised
        if (event.content.msgtype === "m.emote") {
            body = `_${body}_`;
        }

        // replace riot "pill" behavior to "@" mention for slack users
        const htmlString = event.content.formatted_body;
        if (htmlString) {
            const regex = new RegExp('<a href="https://matrix.to/#/#' +
                                     '([^"]+)">([^<]+)</a>', "g");

            let match = regex.exec(htmlString);
            while (match != null) {
                const alias = match[2];
                const client = main.botIntent.getClient();
                const roomIdResponse = await client.getRoomIdForAlias(alias);
                const room = main.getRoomByMatrixRoomId(roomIdResponse.room_id);
                if (room && room.SlackTeamId === teamId) {
                    body = body.replace(alias, `<#${room.SlackChannelId!}>`);
                }
                match = regex.exec(htmlString);
            }
        }

        // convert @room to @channel
        body = body.replace("@room", "@channel");

        // Strip out any language specifier on the code tags, as they are not supported by slack.
        body = body.replace(/```[\w*]+\n/g, "```\n");

        // Note: This slower plainTextSlackMentions call is only used if there is not a pill in the message,
        // meaning if we can we use the much simpler pill subs rather than this.
        const modifiedBody = await plainTextSlackMentions(main, body, event.room_id);

// tslint:disable-next-line: no-any
        const ret: any = {
            link_names: 1,  // This no longer works for nicks but is needed to make @channel work.
            text: modifiedBody,
            username: event.user_id,
        };
        if (event.content.msgtype === "m.image" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            delete ret.text;
            ret.attachments = [{
                fallback: modifiedBody,
                image_url: url,
            }];
        } else if (event.content.msgtype === "m.file" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            ret.text = `<${url}|${modifiedBody}>`;
        }

        return ret;
    }

    public htmlEscape(s: string) {
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
    public async getDisplayMap(main: Main, roomId: string) {
        const displaymap: {[name: string]: string} = {};
        const store = main.userStore;
        const users = await main.listGhostUsers(roomId);
        const storeUsers: {display_name: string, id: string}[][] = await Promise.all(
            users.map((id: string) => store.select({id})),
        );
        storeUsers.forEach((user) => {
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
    public makeFirstWordMap(displaymap) {
        const displaynames = Object.keys(displaymap);
        const firstwords = {};

        for (const dispname of displaynames) {
            const firstword = dispname.split(" ")[0];
            const amap = {};
            amap[dispname] = displaymap[dispname];
            if (firstwords.hasOwnProperty(firstword)) {
                firstwords[firstword].push(amap);
            } else {
                firstwords[firstword] = [amap];
            }
        }
        return firstwords;
    }

    public makeDiff(prev: string, curr: string) {
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

        // return {prev: prev,
        //         curr: curr,
        //         before: before,
        //         after: after};
        return {prev, curr, before, after};
    }

    public getSlackFileUrl(file: {
        permalink_public: string,
        url_private: string,
    }) {
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
 * Do string replacement on a message given the display map.
 *
 * @param {String} string The string to perform replacements on.
 * @param {Object} displaymap A mapping of display names to slack user ids.
 * @return {String} The string with replacements performed.
 */
export function replacementFromDisplayMap(str: string, displaymap: {[matrixId: string]: string}) {
    const firstwords = substitutions.makeFirstWordMap(displaymap);

    // Now parse the message to find the intersection of every word in the
    // message with every first word of all nicks.
    const matchWords = new Set(Object.keys(firstwords));
    const stringWords = new Set(str.split(" "));
    const matches = [...stringWords].filter((x) => matchWords.has(x.substr(x.startsWith("@") ? 1 : 0)));
    for (const firstword of matches) {
        const sglFirstWord = firstword.substr(firstword.startsWith("@") ? 1 : 0);
        const nicks = firstwords[sglFirstWord];
        if (!nicks) {
            continue;
        }

        if (nicks.length === 1) {
            str = str.replace(firstword, `<@${nicks[0][sglFirstWord]}>`);
        } else {
            // Sort the displaynames by longest string first, and then match them from longest to shortest.
            // This can match multiple times if there is more than one mention in the message
            const displaynames: string[] = nicks.map((x: {}) => Object.keys(x)[0]);
            displaynames.sort((x: string, y: string) => y.length - x.length);
            for (const displayname of displaynames) {
                const aDisplayname = `@${displayname}`;
                const includeSig = str.includes(aDisplayname);
                str = str.replace(includeSig ? aDisplayname : displayname, `<@${displaymap[displayname]}>`);
            }
        }
    }
    return str;
}

/**
 * Replace plain text form of @displayname mentions with the slack mention syntax.
 *
 * @param {Main} main the toplevel main instance
 * @param {String} string The string to perform replacements on.
 * @param {String} room_id The room the message was sent in.
 * @return {String} The string with replacements performed.
 */
async function plainTextSlackMentions(main: Main, s: string, roomId: string) {
    return replacementFromDisplayMap(
        s,
        await substitutions.getDisplayMap(main, roomId),
    );
}

// These functions are copied and modified from the Gitter AS
// idx counts backwards from the end of the string; 0 is final character
function rcharAt(s: string, idx: number) {
    return s.charAt(s.length - 1 - idx);
}

function firstWord(s: string) {
    const groups = s.match(/^\s*\S+/);
    return groups ? groups[0] : "";
}

function finalWord(s: string) {
    const groups = s.match(/\S+\s*$/);
    return groups ? groups[0] : "";
}
