"use strict";

const substitutions = require("./substitutions");
const SlackEventHandler = require('./SlackEventHandler');
const BaseSlackHandler = require('./BaseSlackHandler');
const rp = require('request-promise');
const qs = require("querystring");
const Promise = require('bluebird');
const promiseWhile = require("./promiseWhile");
const util = require("util");
const fs = require("fs");

const PRESERVE_KEYS = [
    "team_domain", "team_id",
    "channel_name", "channel_id",
    "user_name", "user_id",
];

/**
 * @constructor
 * @param {Main} main the toplevel bridge instance through which to
 * communicate with matrix.
 */
function SlackHookHandler(main) {
    this._main = main;
    this.eventHandler = new SlackEventHandler(main);
}

util.inherits(SlackHookHandler, BaseSlackHandler);

/**
 * Starts the hook server listening on the given port and (optional) TLS
 * configuration.
 * @param {int} port The TCP port to listen on
 * @param {?Object} tls_config Optional TLS configuration
 * @return {Promise} Returns a Promise that will resolve when the server is
 * ready to accept requests
 */
SlackHookHandler.prototype.startAndListen = function(port, tls_config) {
    let createServer;
    if (tls_config) {
        const tls_options = {
            key: fs.readFileSync(tls_config.key_file),
            cert: fs.readFileSync(tls_config.crt_file)
        };
        createServer = function(cb) {
            return require("https").createServer(tls_options, cb);
        };
    }
    else {
        createServer = require("http").createServer;
    }

    return new Promise((resolve, reject) => {
        createServer(this.onRequest.bind(this)).listen(port, () => {
            const protocol = tls_config ? "https" : "http";
            console.log("Slack-side listening on port " + port + " over " + protocol);
            resolve();
        });
    });
};

SlackHookHandler.prototype.onRequest = function(request, response) {
    var body = "";
    request.on("data", (chunk) => {
        body += chunk;
    });

    request.on("end", () => {
        // if isEvent === true, this was an event emitted from the slack Event API
        // https://api.slack.com/events-api
        const isEvent = request.headers['content-type'] === 'application/json' && request.method === 'POST';
        try {
            if (isEvent) {
                var params = JSON.parse(body);
                this.eventHandler.handle(params, response);
            }
            else {
                var params = qs.parse(body);
                this.handle(request.method, request.url, params, response);
            }
        }
        catch (e) {
            console.error("SlackHookHandler failed:", e);
            response.writeHead(500, {"Content-Type": "text/plain"});
            if (request.method !== "HEAD") {
                response.write("Internal Server Error");
            }
            response.end();
        }
    });
}
/**
 * Handles a slack webhook request.
 *
 * Sends a message to Matrix if it understands enough of the message to do so.
 * Attempts to make the message as native-matrix feeling as it can.
 *
 * @param {Object} params HTTP body of the webhook request, as a JSON-parsed dictionary.
 * @param {string} params.channel_id Slack channel ID receiving the message.
 * @param {string} params.channel_name Slack channel name receiving the message.
 * @param {string} params.user_id Slack user ID of user sending the message.
 * @param {string} params.user_name Slack user name of the user sending the message.
 * @param {?string} params.text Text contents of the message, if a text message.
 * @param {string} timestamp Timestamp when message was received, in seconds
 *     formatted as a float.
 */
SlackHookHandler.prototype.handle = function(method, url, params, response) {
    console.log("Received slack webhook " + method + " " + url + ": ", params);

    var main = this._main;

    var endTimer = main.startTimer("remote_request_seconds");

    var result = url.match(/^\/(.{32})(?:\/(.*))?$/);
    if (!result) {
        console.log("Ignoring message with bad slackhook URL " + url);

        response.writeHead(200, {"Content-Type": "text/plain"});
        response.end();

        endTimer({outcome: "dropped"});
        return;
    }

    var inbound_id = result[1];
    var path = result[2] || "post";

    // GET requests (e.g. authorize) have params in query string
    if (method === "GET") {
        result = path.match(/^([^?]+)(?:\?(.*))$/);
        path = result[1];
        params = qs.parse(result[2]);
    }

    var room = main.getRoomByInboundId(inbound_id);

    if (!room) {
        console.log("Ignoring message from unrecognised inbound ID: %s (%s.#%s)",
            inbound_id, params.team_domain, params.channel_name
        );
        main.incCounter("received_messages", {side: "remote"});

        response.writeHead(200, {"Content-Type": "text/plain"});
        response.end();

        endTimer({outcome: "dropped"});
        return;
    }

    if (method === "POST" && path === "post") {
        this.handlePost(room, params).then(
            () => endTimer({outcome: "success"}),
            (e) => {
                endTimer({outcome: "fail"});

                console.log("Failed: ", e);
            }
        );

        response.writeHead(200, {"Content-Type": "application/json"});
        response.end();
    }
    else if (method === "GET" && path === "authorize") {
        this.handleAuthorize(room, params).then((result) => {
            response.writeHead(result.code || 200, {"Content-Type": "text/html"});
            response.write(result.html);
            response.end();

            endTimer({outcome: "success"});
        });
    }
    else {
        console.log("TODO: Incoming hit to " + path + " to room " + room.getInboundId());

        response.writeHead(200, {"Content-Type": "application/json"});
        if (method !== "HEAD") {
            response.write(JSON.stringify({}));
        }
        response.end();
        endTimer({outcome: "dropped"});
    }
};

SlackHookHandler.prototype.handlePost = function(room, params) {
    // We can't easily query the name of a channel from its ID, but we can
    // infer its current name every time we receive a message, because slack
    // tells us.
    var channel_name = params.team_domain + ".#" + params.channel_name;
    var main = this._main;

    room.updateSlackChannelName(channel_name);
    if (room.isDirty()) {
        main.putRoomToStore(room);
    }

    // TODO(paul): This will reject every bot-posted message, both our own
    //   reflections and other messages from other bot integrations. It would
    //   be nice if we could distinguish the two by somehow learning our own
    //   'bot_id' parameter.
    //     https://github.com/matrix-org/matrix-appservice-slack/issues/29
    if (params.user_id === "USLACKBOT") {
        return Promise.resolve();
    }

    // Only count received messages that aren't self-reflections
    main.incCounter("received_messages", {side: "remote"});

    var token = room.getAccessToken();

    if (!token) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        console.log("no slack token for " + params.team_domain);

        if (params.text) {
            return room.onSlackMessage(params);
        }
        return Promise.resolve();
    }

    var text = params.text;
    if (undefined == text) {
        // TODO(paul): When I started looking at this code there was no lookupAndSendMessage()
        //   I wonder if this code path never gets called...?
        // lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
        return Promise.resolve();
    }

    return this.lookupMessage(params.channel_id, params.timestamp, token).then((msg) => {
        if(undefined == msg) {
            msg = params;
        }

        // Restore the original parameters, because we've forgotten a lot of
        // them by now
        PRESERVE_KEYS.forEach((k) => msg[k] = params[k]);
        msg.markdownText = msg.text;
        return this.replaceChannelIdsWithNames(msg, token);
    }).then((msg) => {
        return this.replaceUserIdsWithNames(msg, token);
    }).then((msg) => {
        // we can't use .finally here as it does not get the final value, see https://github.com/kriskowal/q/issues/589
        return room.onSlackMessage(msg);
    });
};

SlackHookHandler.prototype.handleAuthorize = function(room, params) {
    var oauth2 = this._main.getOAuth2();
    if (!oauth2) {
        console.log("Wasn't expecting to receive /authorize without OAuth2 configured");
        return;
    }

    console.log("Exchanging temporary code for full OAuth2 token for " + room.getInboundId());

    return oauth2.exchangeCodeForToken({
        code: params.code,
        room: room,
    }).then((result) => {
        console.log("Got a full OAuth2 token");

        room.updateAccessToken(result.access_token, result.access_scopes);
        return this._main.putRoomToStore(room);
    }).then(
        () => {
            return {
                html: `
<h2>Integration Successful!</h2>

<p>Your Matrix-Slack channel integration is now correctly authorized.</p>
`
            };
        },
        (err) => {
            return {
                code: 403,
                html: `
<h2>Integration Failed</h2>

<p>Unfortunately your channel integration did not go as expected...</p>
`
            };
        }
    );
};

SlackHookHandler.prototype.replaceChannelIdsWithNames = function(message, token) {
    var main = this._main;

    // match all channelIds
    var testForName = message.text.match(/<#(\w+)\|?\w*?>/g);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(function() {
        // Do this until there are no more channel ID matches
        return iteration < matches;
    }, function() {
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

SlackHookHandler.prototype.replaceUserIdsWithNames = function(message, token) {
    var main = this._main;

    // match all userIds
    var testForName = message.text.match(/<@(\w+)\|?\w*?>/g);
    var iteration = 0;
    var matches = 0;
    if (testForName && testForName.length) {
        matches = testForName.length;
    }
    return promiseWhile(() => {
        // Condition for stopping
        return iteration < matches;
    }, function() {
        // foreach userId, pull out the ID
        // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
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
            const user_id = main.getUserId(id, message.team_domain);
            if (response && response.user && response.user.name) {
                console.log("users.info: " + id + " mapped to " + response.user.name);

                const pill = `[${response.user.name}](https://matrix.to/#/${user_id})`;
                message.text = message.text.replace(/<@(\w+)\|?\w*?>/, response.user.name);
                message.markdownText = message.markdownText.replace(
                    /<@(\w+)\|?\w*?>/,
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
            console.log(`${user_id} did ${result.length > 0 ? "not" : ""} an entry`);
            if (result.length) {
                // It's possible not to have a displayname set.
                const name = result[0].display_name || result[0].id;

                const pill = `[${name}](https://matrix.to/#/${user_id})`;
                message.text = message.text.replace(/<@(\w+)\|?\w*?>/, name);
                message.markdownText = message.markdownText.replace(
                    /<@(\w+)\|?\w*?>/,
                    pill
                );
            }
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
 * Attempts to handle a message received from a slack webhook request.
 *
 * The webhook request that we receive doesn't have enough information to richly
 * represent the message in Matrix, so we look up more details.
 *
 * @param {string} channelID Slack channel ID.
 * @param {string} timestamp Timestamp when message was received, in seconds
 *     formatted as a float.
 * @param {Intent} intent Intent for sending messages as the relevant user.
 * @param {string} roomID Matrix room ID associated with channelID.
 */
//SlackHookHandler.prototype.lookupAndSendMessage =
SlackHookHandler.prototype.lookupMessage = function(channelID, timestamp, token) {
    // Look up all messages at the exact timestamp we received.
    // This has microsecond granularity, so should return the message we want.
    var params = {
        method: 'POST',
        form : {
            channel: channelID,
            latest: timestamp,
            oldest: timestamp,
            inclusive: "1",
            token: token,
        },
        uri: "https://slack.com/api/channels.history",
        json: true
    };
    this._main.incRemoteCallCounter("channels.history");
    return rp(params).then((response) => {
        if (!response || !response.messages || response.messages.length === 0) {
            console.log("Could not find history: " + response);
            return undefined;
        }
        if (response.messages.length != 1) {
            // Just laziness.
            // If we get unlucky and two messages were sent at exactly the
            // same microsecond, we could parse them all, filter by user,
            // filter by whether they have attachments, and such, and pick
            // the right message. But this is unlikely, and I'm lazy, so
            // we'll just drop the message...
            console.log("Really unlucky, got multiple messages at same" +
                " microsecond, dropping:" + response);
            return undefined;
        }
        var message = response.messages[0];
        console.log("Looked up message from history as " + JSON.stringify(message));

        if (messages.subtype !== "file_share") {
            return message;
        }
        return this.enablePublicSharing(message.file, token)
        .then((file) => {
            message.file = file;
            return this.fetchFileContent(message.file, token);
        }).then((content) => {
            message.file._content = content;
            return message;
        }).catch((err) => {
            console.error("Failed to get file content: ", err);
        });
    });
}

module.exports = SlackHookHandler;
