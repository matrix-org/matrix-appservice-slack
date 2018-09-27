"use strict";

const rp = require('request-promise');
const Promise = require('bluebird');
const promiseWhile = require("./promiseWhile");
const getSlackFileUrl = require("./substitutions").getSlackFileUrl;

const CHANNEL_ID_REGEX = /<#(\w+)\|?\w*?>/g;
const CHANNEL_ID_REGEX_FIRST = /<#(\w+)\|?\w*?>/;

// (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
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
                console.log("channels.info: " + id + " mapped to " + response.channel.name);
                name = response.channel.name;
            }
            else {
                console.log("channels.info returned no result for " + id);
            }
            message.text = message.text.replace(CHANNEL_ID_REGEX_FIRST, "#" + name);
            iteration++;
            }).catch((err) => {
               console.log("Caught error " + err);
            });
    }).then(() => {
        // Notice we can chain it because it's a Promise,
        // this will run after completion of the promiseWhile Promise!
        return message;
    });
};

BaseSlackHandler.prototype.replaceUserIdsWithNames = function(message, token) {
    var main = this._main;

    // match all userIds
    var testForName = message.text.match(USER_ID_REGEX);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(() => {
        // Condition for stopping
        return iteration < matches;
    }, function () {
        // foreach userId, pull out the ID
        // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
        var id = testForName[iteration].match(USER_ID_REGEX_FIRST)[1];
        var channelsInfoApiParams = {
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: token,
                user: id
            },
            json: true
        };
        main.incRemoteCallCounter("users.info");
        return rp(channelsInfoApiParams).then((response) => {
            const user_id = main.getUserId(id, message.team_domain);
            if (response && response.user && response.user.name) {
                console.log("users.info: " + id + " mapped to " + response.user.name);

                const pill = `[${response.user.name}](https://matrix.to/#/${user_id})`;
                message.text = message.text.replace(USER_ID_REGEX_FIRST, response.user.name);
                message.markdownText = message.markdownText.replace(
                    USER_ID_REGEX_FIRST,
                    pill
                );
                return;
            }
            console.log(`users.info returned no result for ${id} Response:`, response);
            // Fallback to checking the user store.
            var store = this.getUserStore();
            return store.select({id: user_id});
        }).then((result) => {
            if (result === undefined) {
                return;
            }
            let name = user_id;
            console.log(`${user_id} did ${result.length > 0 ? "not" : ""} an entry`);
            if (result.length) {
                // It's possible not to have a displayname set.
                name = result[0].display_name || result[0].id;
            }
            message.text = message.text.replace(USER_ID_REGEX_FIRST, name);
            message.markdownText = message.markdownText.replace(
                USER_ID_REGEX_FIRST,
                `[${name}](https://matrix.to/#/${user_id})`
            );
        }).catch((err) => {
            console.log("Caught error " + err);
        });
        iteration++;
    }).then(() => {
        // Notice we can chain it because it's a Promise,
        // this will run after completion of the promiseWhile Promise!
        return message;
    });
};


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
            console.log("Could not find sharedPublichURL: " + JSON.stringify(response));
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
        console.log("Successfully fetched file " + file.id +
            " content (" + content.length + " bytes)");
        return content;
    });
};

module.exports = BaseSlackHandler;
