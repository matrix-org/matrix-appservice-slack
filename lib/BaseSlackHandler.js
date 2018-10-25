"use strict";

const rp = require('request-promise');
const Promise = require('bluebird');
const promiseWhile = require("./promiseWhile");
const getSlackFileUrl = require("./substitutions").getSlackFileUrl;
const slackGhost = require("./SlackGhost");
const log = require("matrix-appservice-bridge").Logging.get("BaseSlackHandler");

const CHANNEL_ID_REGEX = /<#(\w+)\|?\w*?>/g;
const CHANNEL_ID_REGEX_FIRST = /<#(\w+)\|?\w*?>/;

// (if the message is an emote, the format is <@ID|nick>, but in normal msgs it's just <@ID>
const USER_ID_REGEX = /<@(\w+)\|?\w*?>/g;
const USER_ID_REGEX_FIRST = /<@(\w+)\|?\w*?>/;

/**
 * @constructor
 * @param {Main} main the toplevel bridge instance through which to
 * communicate with matrix.
 */
function BaseSlackHandler(main) {
    this._main = main;
}

BaseSlackHandler.prototype.replaceChannelIdsWithNames = function(message, token) {
    var main = this._main;

    // match all channelIds
    var testForName = message.text.match(CHANNEL_ID_REGEX);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(function () {
        // Do this until there are no more channel ID matches
        return iteration < matches;
    }, function () {
        // foreach channelId, pull out the ID
        // (if this is an emote msg, the format is <#ID|name>, but in normal msgs it's just <#ID>
        var id = testForName[iteration].match(CHANNEL_ID_REGEX_FIRST)[1];
        var channelsInfoApiParams = {
            uri: 'https://slack.com/api/channels.info',
            qs: {
                token: token,
                channel: id
            },
            json: true
        };
        main.incRemoteCallCounter("channels.info");
        return rp(channelsInfoApiParams).then((response) => {
            let name = id;
            if (response && response.channel && response.channel.name) {
                log.info("channels.info: " + id + " mapped to " + response.channel.name);
                name = response.channel.name;
            }
            else {
                log.info("channels.info returned no result for " + id);
            }
            message.text = message.text.replace(CHANNEL_ID_REGEX_FIRST, "#" + name);
            iteration++;
            }).catch((err) => {
               log.error("Caught error handling channels.info:" + err);
            });
    }).then(() => {
        // Notice we can chain it because it's a Promise,
        // this will run after completion of the promiseWhile Promise!
        return message;
    });
};

BaseSlackHandler.prototype.replaceUserIdsWithNames = async function(message, token) {
    var main = this._main;

    let match = USER_ID_REGEX.exec(message.text);
    while (match != null) {
        // foreach userId, pull out the ID
        // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
        var id = match[0].match(USER_ID_REGEX_FIRST)[1];

        const team_domain = await main.getTeamDomainForMessage(message);

        let display_name = "";
        let user_id = main.getUserId(id, team_domain);

        const store = main.getUserStore();
        const users = await store.select({id: user_id});

        if (users === undefined || !users.length) {
            log.warn("Mentioned user not in store. Looking up display name from slack.");
            // if the user is not in the store then we look up the displayname
            const nullGhost = new slackGhost({main: main});
            var room = main.getRoomBySlackChannelId(message.channel);
            display_name = await nullGhost.getDisplayName(id, room.getAccessToken());
            // If the user is not in the room, we cant pills them, we have to just plain text mention them.
            message.text = message.text.replace(USER_ID_REGEX_FIRST, display_name);
        } else {
            display_name = users[0].display_name || user_id;
            message.text = message.text.replace(
                USER_ID_REGEX_FIRST,
                `<https://matrix.to/#/${user_id}|${display_name}>`
            );
        }
        // Check for the next match.
        match = USER_ID_REGEX.exec(message.text);
    }
    return message;
}

/**
 * Enables public sharing on the given file object. then fetches its content.
 *
 * @param {Object} file A slack 'message.file' data object
 * @param {string} token A slack API token that has 'files:write:user' scope
 * @return {Promise<Object>} A Promise of the updated slack file data object
 */
BaseSlackHandler.prototype.enablePublicSharing = function (file, token) {
    if (file.public_url_shared) return Promise.resolve(file);

    this._main.incRemoteCallCounter("files.sharedPublicURL");
    return rp({
        method: 'POST',
        form: {
            file: file.id,
            token: token,
        },
        uri: "https://slack.com/api/files.sharedPublicURL",
        json: true
    }).then((response) => {
        if (!response || !response.file || !response.file.permalink_public) {
            log.warn("Could not find sharedPublicURL: " + JSON.stringify(response));
            return undefined;
        }

        return response.file;
    });
}

/**
 * Fetchs the file at a given url.
 *
 * @param {Object} file A slack 'message.file' data object
 * @return {Promise<string>} A Promise of file contents
 */
BaseSlackHandler.prototype.fetchFileContent = function (file, token) {
    if (!file) return Promise.resolve();

    const url = getSlackFileUrl(file) || file.permalink_public;
    if (!url) {
        return Promise,reject("File doesn't have any URLs we can use.");
    }

    return rp({
        uri: url,
        resolveWithFullResponse: true,
        encoding: null
    }).then((response) => {
        var content = response.body;
        log.debug("Successfully fetched file " + file.id +
            " content (" + content.length + " bytes)");
        return content;
    });
};

module.exports = BaseSlackHandler;
