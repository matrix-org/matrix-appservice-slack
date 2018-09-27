"use strict";

const rp = require('request-promise');
const Promise = require('bluebird');
const promiseWhile = require("./promiseWhile");
const getSlackFileUrl = require("./substitutions").getSlackFileUrl;

const CHANNEL_ID_REGEX = /<#(\w+)\|?\w*?>/g;

// (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
const USER_ID_REGEX = /<@(\w+)\|?\w*?>/g;

/**
 * @constructor
 * @param {Main} main the toplevel bridge instance through which to
 * communicate with matrix.
 */
function BaseSlackHandler(main) {
    this._main = main;
}

BaseSlackHandler.prototype.replaceChannelIdsWithNames = function (message, token) {
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
        var id = testForName[iteration].match(/<#(\w+)\|?\w*?>/)[1];
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
            if (response && response.channel && response.channel.name) {
                console.log("channels.info: " + id + " mapped to " + response.channel.name);
                message.text = message.text.replace(/<#(\w+)\|?\w*?>/, "#" + response.channel.name);
            }
            else {
                console.log("channels.info returned no result for " + id);
            }
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

BaseSlackHandler.prototype.replaceUserIdsWithNames = function (message, token) {
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
        var id = testForName[iteration].match(/<@(\w+)\|?\w*?>/)[1];
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
            if (response && response.user && response.user.profile) {
                var name = response.user.profile.display_name || response.user.profile.real_name;
                console.log("users.info: " + id + " mapped to " + name);
                message.text = message.text.replace(/<@(\w+)\|?\w*?>/, name);
            }
            else {
                console.log("users.info returned no result for " + id);
            }
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

    // if (file.is_public) {
        var url = getSlackFileUrl(file);
        if (!url) url = file.permalink_public;
    // } else {
    //     url = file.url_private
    // }

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
