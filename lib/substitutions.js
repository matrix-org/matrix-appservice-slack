"use strict";

var fs = require("fs");

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
    console.log("running substitutions on: " + body);

    if (undefined != body) {
        for (var i = 0; i < SUBSTITUTION_PAIRS.length; ++i) {
            var pair = SUBSTITUTION_PAIRS[i];
            body = replaceAll(body, pair.slack, pair.matrix);
        }
    }

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
    // we use replace to run a function on each match, replacing matches in buf
    // (returning the match to body doesn't work, hence this approach)
    var buf = body;
    body.replace(/(?=(:[^: ]+?:))/g, function(fullMatch, match1) {
        if (undefined == emojiIndex[match1]) {
            console.log("Failed to recognise emoji sequence: " + match1);
        }
        else {
            buf = buf.replace(match1, emojiIndex[match1]);
        }
        return;
    });
    return buf;
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
    console.log("Event from matrix: " + JSON.stringify(event));

    var string = event.content.body;

    // remove <> from links, e.g:
    // 
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
    }

    // the link_names flag means that writing @username will act as a mention in slack
    var ret = {
        username: event.user_id,
        text: string,
        link_names: 1
    }
    if (event.content.msgtype == "m.image" && event.content.url.indexOf("mxc://") === 0) {
        var url = main.getUrlForMxc(event.content.url);
        delete ret.text;
        ret.attachments = [{
            fallback: string,
            image_url: url
        }];
    }

    return ret;
};

module.exports = {
    matrixToSlack: matrixToSlack,
    slackToMatrix: slackToMatrix,
    getSlackFileUrl: getSlackFileUrl
};
