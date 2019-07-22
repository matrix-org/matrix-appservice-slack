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
const log = require("matrix-appservice-bridge").Logging.get("SlackHookHandler");

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
            log.info("Slack-side listening on port " + port + " over " + protocol);
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
            log.error("SlackHookHandler failed:", e);
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
    log.info("Received slack webhook " + method + " " + url + ": " + JSON.stringify(params));

    var main = this._main;

    var endTimer = main.startTimer("remote_request_seconds");

    var result = url.match(/^\/(.{32})(?:\/(.*))?$/);
    if (!result) {
        log.warn("Ignoring message with bad slackhook URL " + url);

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
    // authorize is special
    if (!room && path !== "authorize") {
        log.warn("Ignoring message from unrecognised inbound ID: %s (%s.#%s)",
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

                log.error("handlePost failed: ", e);
            }
        );

        response.writeHead(200, {"Content-Type": "application/json"});
        response.end();
    }
    else if (method === "GET" && path === "authorize") {
        this.handleAuthorize(room || inbound_id, params).then((result) => {
            response.writeHead(result.code || 200, {"Content-Type": "text/html"});
            response.write(result.html);
            response.end();

            endTimer({outcome: "success"});
        });
    }
    else {
        // TODO: Handle this
        log.debug(`Got call to ${method}${path} that we can't handle`);
        response.writeHead(200, {"Content-Type": "application/json"});
        if (method !== "HEAD") {
            response.write("{}");
        }
        response.end();
        endTimer({outcome: "dropped"});
    }
};

SlackHookHandler.prototype.handlePost = async function(room, params) {
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
        return;
    }

    // Only count received messages that aren't self-reflections
    main.incCounter("received_messages", {side: "remote"});

    const token = room.getAccessToken();

    if (!token) {
        // If we can't look up more details about the message
        // (because we don't have a master token), but it has text,
        // just send the message as text.
        log.warn("no slack token for " + params.team_domain);

        if (params.text) {
            return room.onSlackMessage(params);
        }
        return;
    }

    let text = params.text;
    if (undefined == text) {
        // TODO(paul): When I started looking at this code there was no lookupAndSendMessage()
        //   I wonder if this code path never gets called...?
        // lookupAndSendMessage(params.channel_id, params.timestamp, intent, roomID, token);
        return;
    }

    // Use params if msg is not found.
    const msg = (await this.lookupMessage(params.channel_id, params.timestamp, token)) || params;

    // Restore the original parameters, because we've forgotten a lot of
    // them by now
    PRESERVE_KEYS.forEach((k) => msg[k] = params[k]);
    msg.text = await this.replaceChannelIdsWithNames(msg, msg.text, token);
    msg.text = await this.replaceUserIdsWithNames(msg, msg.text, token);    
    return room.onSlackMessage(msg);
};

SlackHookHandler.prototype.handleAuthorize = function(roomOrToken, params) {
    const oauth2 = this._main.getOAuth2();
    if (!oauth2) {
        log.warn("Wasn't expecting to receive /authorize without OAuth2 configured");
        return Promise.resolve({
            code: 500,
            html: `OAuth is not configured on this bridge.`
        });
    }
    let room, user = null;
    if (typeof roomOrToken === "string") {
        user = oauth2.getUserIdForPreauthToken(roomOrToken);
        // This might be a user token.
        if (!user) {
            return Promise.resolve({
                code: 500,
                html: `Token not known.`
            });
        }
    } else {
        room = roomOrToken;
    }

    log.debug("Exchanging temporary code for full OAuth2 token " +
        (user ? user : room.getInboundId())
    );

    return oauth2.exchangeCodeForToken({
        code: params.code,
        room: roomOrToken,
    }).then((result) => {
        log.debug("Got a full OAuth2 token");
        if (room) { // Legacy webhook
            room.updateAccessToken(result.access_token, result.access_scopes);
            return this._main.putRoomToStore(room);
        } else { // New event api
            console.log(result);
            this._main.setUserAccessToken(
                user,
                result.team_id,
                result.user_id,
                result.access_token,
            );
            this._main.updateTeamBotStore(
                result.team_id,
                result.team_name,
                result.bot.bot_user_id,
                result.bot.bot_access_token,
            );
            return null;
        }
    }).then(
        () => {
            return {
                html: `
<h2>Integration Successful!</h2>

<p>Your Matrix-Slack ${room ? "channel integration" : "account" } is now correctly authorized.</p>
`
            };
        },
        (err) => {
            log.error("Error during handling of an oauth token:", err);
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
            log.warn("Could not find history: " + response);
            return undefined;
        }
        if (response.messages.length != 1) {
            // Just laziness.
            // If we get unlucky and two messages were sent at exactly the
            // same microsecond, we could parse them all, filter by user,
            // filter by whether they have attachments, and such, and pick
            // the right message. But this is unlikely, and I'm lazy, so
            // we'll just drop the message...
            log.warn("Really unlucky, got multiple messages at same" +
                " microsecond, dropping:" + response);
            return undefined;
        }
        var message = response.messages[0];
        log.debug("Looked up message from history as " + JSON.stringify(message));

        if (message.subtype !== "file_share") {
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
            log.error("Failed to get file content: ", err);
        });
    });
}

module.exports = SlackHookHandler;
