"use strict";

const fs = require("fs");
const log = require("matrix-appservice-bridge").Logging.get("substitutions");

// Ordered
var SUBSTITUTION_PAIRS = [];

function add(slack, matrix) {
    SUBSTITUTION_PAIRS.push({
        slack: slack,
        matrix: matrix
    });
}

// slack -> matrix substitutions are performed top -> bottom
// matrix -> slack substitutions are performed bottom -> top
//
// The ordering here matters because some characters are present in both the
// "old" and "new" patterns, and we may end up over- or under-escaping things,
// or in an escaping loop, if things aren't properly ordered.
add("&lt;", "<");
add("&gt;", ">");
add("&amp;", "&"); // &amp; must be after all replacements involving &s.

var emojiIndex = (function () {
    var emojiJson = fs.readFileSync("./external/emoji-data/emoji.json");
    var emoji = JSON.parse(emojiJson);
    var index = {};
    for (var i = 0; i < emoji.length; ++i) {
        var e = emoji[i];
        for (var j = 0; j < e.short_names.length; ++j) {
            if (e["unified"].indexOf("-") < 0) {
                var char = String.fromCodePoint(parseInt(e["unified"], 16));
                index[":" + e.short_names[j] + ":"] = char;
            }
        }
    }
    index[":simple_smile:"] = index[":smile:"];
    index[":+1:"] = index[":thumbsup:"];
    index[":squirrel:"] = index[":chipmunk:"];
    index[":shipit:"] = index[":chipmunk:"]; // https://www.quora.com/GitHub-What-is-the-significance-of-the-Ship-It-squirrel
    return index;
})();

function replaceAll(string, old, replacement) {
    return string.split(old).join(replacement);
}

/**
 * Performs any escaping, unescaping, or substituting required to make the text
 * of a Slack message appear like the text of a Matrix message.
 *
 * @param {string} string the text, in Slack's format.
 * @param {Object} file options slack file object
 */
var slackToMatrix = function(body, file) {
    log.info("running substitutions on: " + body);

    if (undefined != body) {
        for (var i = 0; i < SUBSTITUTION_PAIRS.length; ++i) {
            var pair = SUBSTITUTION_PAIRS[i];
            body = replaceAll(body, pair.slack, pair.matrix);
        }
    }

    // convert @channel to @room
    body = body.replace("<!channel>", "@room");

    // escape slack-links e.g:
    // "hello @oddvar:<http://oddvar.org|oddvar.org> how are ya"
    // becomes
    // hello @oddvar:http://oddvar.org how are ya
    body = body.replace(/<(https?:\/\/[^\|]+?)\|[^>]+?>/g, '$1');

    // remove <> from links. if you post http://oddvar.org in slack,
    // this becomes <http://oddvar.org> in the event sent to Matrix
    // so we need to strip <> from the link
    body = body.replace(/<(https?:\/\/[^>]+?)>/g, '$1');

    // if we have a file, attempt to get the direct link to the file
    if (file && file.public_url_shared) {
        var url = getSlackFileUrl(file);
        body = body.replace(file.permalink, url);
    }

    // attempt to match any text inside colons to emoji, e.g. :smiley:
    // we use replace to run a function on each match.
    body = body.replace(/:([+-z]|_)+:/g, (emojiKey) => {
        const emojiChar = emojiIndex[emojiKey];
        if (emojiChar !== undefined) {
            return emojiChar;
        }
        log.warn("Failed to recognise emoji sequence: " + emojiKey);
        return emojiKey;
    });
    return body;
};

var getSlackFileUrl = function(file) {
    var pub_secret = file.permalink_public.match(/https?:\/\/slack-files.com\/[^-]*-[^-]*-(.*)/);
    // try to get direct link to the file
    if (pub_secret !== undefined && pub_secret.length > 0) {
        return file.url_private + "?pub_secret=" + pub_secret[1];
    }
};

/**
 * Performs any escaping, unescaping, or substituting required to make the text
 * of a Matrix message appear like the text of a Slack message.
 *
 * @param {MatrixEvent} event the Matrix event.
 * @param {Main} main the toplevel main instance
 * @return An object which can be posted as JSON to the Slack API.
 */
var matrixToSlack = function(event, main) {
    log.debug("Event from matrix: " + JSON.stringify(event));

    var string = event.content.body;

    // remove <> from links, e.g:
    string = string.replace(/<((https?:\/\/)?[^>]+?)>/g, '$1');

    if (undefined != string) {
        for (var i = SUBSTITUTION_PAIRS.length - 1; i >= 0; --i) {
            var pair = SUBSTITUTION_PAIRS[i];
            string = replaceAll(string, pair.matrix, pair.slack);
        }
        // emotes in slack are just italicised
        if (event.content.msgtype == "m.emote") {
            string = "_" + string + "_";
        }

        // replace riot "pill" behavior to "@" mention for slack users
        const html_string = event.content.formatted_body;
        if (undefined != html_string) {
            const regex = new RegExp('<a href="https://matrix.to/#/@' +
                                   main.getUserIDPrefix() +
                                   '([^"]+)">([^<]+)</a>', "g");

            let match = regex.exec(html_string);
            while (match != null) {
                // Extract the slack ID from the matrix id
                const userid = match[1].split("_")[1].split(":")[0];
                // Construct the new slack mention
                string = string.replace(match[2], "<@" + userid + ">");
                match = regex.exec(html_string);
            }
        }
    }

    // convert @room to @channel
    string = string.replace("@room", "@channel");

    // Strip out any language specifier on the code tags, as they are not supported by slack.
    string = string.replace(/```[\w*]+\n/g, "```\n");

    // Note: This slower plainTextSlackMentions call is only used if there is not a pill in the message,
    // meaning if we can we use the much simpler pill subs rather than this.
    return plainTextSlackMentions(main, string, event.room_id).then(string => {
        const ret = {
            username: event.user_id,
            text: string,
            link_names: 1  //This no longer works for nicks but is needed to make @channel work.
        };
        if (event.content.msgtype == "m.image" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            delete ret.text;
            ret.attachments = [{
                fallback: string,
                image_url: url
            }];
        } else if (event.content.msgtype == "m.file" && event.content.url.indexOf("mxc://") === 0) {
            const url = main.getUrlForMxc(event.content.url);
            ret.text = "<" + url + "|" + string + ">";
        }

        return ret;
    });
}

var htmlEscape = function(s) {
    return s.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
};

/**
 * Get a mapping of the nicknames of all Slack Ghosts in the room to their slack user ids.
 *
 * @param {String} room_id The room id to make the maps for.
 * @return {Promise} A mapping of display name to slack user id.
 */
function getDisplayMap(main, room_id) {
    const store = main.getUserStore();
    return main.listGhostUsers(room_id)
        .then(users => Promise.all(users.map(user => store.select({id: user}))))
        .then(users => {
            const displaymap = {};
            users.forEach(user => {
                if (user && user[0]) {
                    displaymap[user[0].display_name] = user[0].id.split("_")[2].split(":")[0];
                }
            });
            return displaymap;
        });
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
function makeFirstWordMap(displaymap) {
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


/**
 * Do string replacement on a message given the display map.
 *
 * @param {String} string The string to perform replacements on.
 * @param {Object} displaymap A mapping of display names to slack user ids.
 * @return {String} The string with replacements performed.
 */
function replacementFromDisplayMap(string, displaymap) {
    const firstwords = makeFirstWordMap(displaymap);

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
function plainTextSlackMentions(main, string, room_id) {
    return getDisplayMap(main, room_id).then(displaymap => replacementFromDisplayMap(string, displaymap));
}



// These functions are copied and modified from the Gitter AS
// idx counts backwards from the end of the string; 0 is final character
function rcharAt(s,idx) {
    return s.charAt(s.length-1 - idx);
}

function firstWord(s) {
    var groups = s.match(/^\s*\S+/);
    return groups ? groups[0] : "";
}

function finalWord(s) {
    var groups = s.match(/\S+\s*$/);
    return groups ? groups[0] : "";
}

function makeDiff(prev, curr) {
    var i;
    for (i = 0; i < curr.length && i < prev.length; i++) {
        if (curr.charAt(i) != prev.charAt(i)) break;
    }
    // retreat to the start of a word
    while(i > 0 && /\S/.test(curr.charAt(i-1))) i--;

    var prefixLen = i;

    for(i = 0; i < curr.length && i < prev.length; i++) {
        if (rcharAt(curr, i) != rcharAt(prev, i)) break;
    }
    // advance to the end of a word
    while(i > 0 && /\S/.test(rcharAt(curr, i-1))) i--;

    var suffixLen = i;

    // Extract the common prefix and suffix strings themselves and
    //   mutate the prev/curr strings to only contain the differing
    //   middle region
    var prefix = curr.slice(0, prefixLen);
    curr = curr.slice(prefixLen);
    prev = prev.slice(prefixLen);

    var suffix = "";
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

    var before = finalWord(prefix);
    if (before != prefix) { before = "... " + before; }

    var after = firstWord(suffix);
    if (after != suffix) { after = after + " ..."; }

    // return {prev: prev,
    //         curr: curr,
    //         before: before,
    //         after: after};
    return {prev, curr, before, after};
}

module.exports = {
    matrixToSlack: matrixToSlack,
    slackToMatrix: slackToMatrix,
    getSlackFileUrl: getSlackFileUrl,
    htmlEscape: htmlEscape,
    replacementFromDisplayMap: replacementFromDisplayMap,
    makeFirstWordMap: makeFirstWordMap,
    makeDiff: makeDiff
};
