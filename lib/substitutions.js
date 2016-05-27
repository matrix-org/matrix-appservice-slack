"use strict";

var fs = require("fs");

// Ordered
var substitutionPairs = [];

function add(slack, matrix) {
    substitutionPairs.push({
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
    index[":slightly_smiling_face:"] = index[":smile:"];
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
 */
var slackToMatrix = function(string) {
    console.log("running substitutions on: " + string);

    for (var i = 0; i < substitutionPairs.length; ++i) {
        var pair = substitutionPairs[i];
        string = replaceAll(string, pair.slack, pair.matrix);
    }

    string = string.replace(/:\w+?:/g, function(match) {
        if (undefined == emojiIndex[match]) {
            console.log("Failed to recognise emoji sequence: " + match)
            // return nothing rather than undefined
            return "";
        }
        else {
            return emojiIndex[match];
        }
    });

    // escape URLs, especially for "hello @oddvar:<http://oddvar.org|oddvar.org> how are ya"
    string = string.replace(/<https?:\/\/[^\|]+?\|([^>]+?)>/g, '$1');

    return string;
};

/**
 * Performs any escaping, unescaping, or substituting required to make the text
 * of a Matrix message appear like the text of a Slack message.
 *
 * @param {MatrixEvent} event the Matrix event.
 * @return An object which can be posted as JSON to the Slack API.
 */
var matrixToSlack = function(event, homeserver) {

    var string = event.content.body;

    for (var i = substitutionPairs.length - 1; i >= 0; --i) {
        var pair = substitutionPairs[i];
        string = replaceAll(string, pair.matrix, pair.slack);
    }
    // emotes in slack are just italicised
    if (event.content.msgtype == "m.emote") {
        string = "_" + string + "_";
    }

    // the link_names flag means that writing @username will act as a mention in slack
    var ret = {
        username: event.user_id,
        text: string,
        link_names: 1
    }
    if (event.content.msgtype == "m.image" && event.content.url.indexOf("mxc://") === 0) {
        var url = homeserver.url + "/_matrix/media/v1/download/" +
            event.content.url.substring("mxc://".length);
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
    slackToMatrix: slackToMatrix
};
