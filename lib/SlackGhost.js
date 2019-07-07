"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const matrix_appservice_bridge_1 = require("matrix-appservice-bridge");
const rp = require("request-promise-native");
const Slackdown = require("Slackdown");
const log = matrix_appservice_bridge_1.Logging.get("SlackGhost");
// How long in milliseconds to cache user info lookups.
const USER_CACHE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
class SlackGhost {
    constructor(main, userId, displayName, avatarUrl, intent) {
        this.main = main;
        this.userId = userId;
        this.displayName = displayName;
        this.avatarUrl = avatarUrl;
        this.intent = intent;
    }
    static fromEntry(main, entry, intent) {
        return new SlackGhost(main, entry.id, entry.display_name, entry.avatar_url, intent);
    }
    toEntry() {
        return {
            id: this.userId,
            display_name: this.displayName,
            avatar_url: this.avatarUrl,
        };
    }
    update(message, room) {
        log.info("Updating user information for " + message.user_id);
        return Promise.all([
            this.updateDisplayname(message, room).catch((e) => {
                log.error("Failed to update ghost displayname:", e);
            }),
            this.updateAvatar(message, room).catch((e) => {
                log.error("Failed to update ghost avatar:", e);
            }),
        ]);
    }
    async getDisplayname(slackUserId, slackAccessToken) {
        const user = await this.lookupUserInfo(slackUserId, slackAccessToken);
        if (user && user.profile) {
            return user.profile.display_name || user.profile.real_name;
        }
    }
    async updateDisplayname(message, room) {
        const token = room.AccessToken;
        if (!token) {
            return;
        }
        let displayName = message.username || message.user_name;
        if (message.bot_id) {
            displayName = await this.getBotName(message.bot_id, room.AccessToken);
        }
        else if (message.user_id) {
            displayName = await this.getDisplayname(message.user_id, token);
        }
        if (!displayName || this.displayName === displayName) {
            return; // Nothing to do.
        }
        await this.intent.setDisplayName(displayName);
        this.displayName = displayName;
        return this.main.putUserToStore(this);
    }
    async lookupAvatarUrl(slackUserId, slackAccessToken) {
        const user = await this.lookupUserInfo(slackUserId, slackAccessToken);
        if (!user || !user.profile)
            return;
        const profile = user.profile;
        // Pick the original image if we can, otherwise pick the largest image
        // that is defined
        return profile.image_original ||
            profile.image_1024 || profile.image_512 || profile.image_192 ||
            profile.image_72 || profile.image_48;
    }
    async getBotInfo(bot, token) {
        if (!token)
            return;
        this.main.incRemoteCallCounter("bots.info");
        return await rp({
            uri: 'https://slack.com/api/bots.info',
            qs: {
                token: token,
                bot,
            },
            json: true,
        });
    }
    async getBotName(botId, token) {
        const response = await this.getBotInfo(botId, token);
        if (!response.bot || !response.bot.name) {
            log.error("Failed to get bot name", response);
            return;
        }
        return response.bot.name;
    }
    async getBotAvatarUrl(botId, token) {
        const response = await this.getBotInfo(botId, token);
        if (!response.bot || !response.bot.icons.image_72) {
            log.error("Failed to get bot name", response);
            return;
        }
        ;
        const icons = response.bot.icons;
        return icons.image_original || icons.image_1024 || icons.image_512 ||
            icons.image_192 || icons.image_72 || icons.image_48;
    }
    async lookupUserInfo(slackUserId, slackAccessToken) {
        if (this.userInfoCache) {
            log.debug("Using cached userInfo for", slackUserId);
            return this.userInfoCache;
        }
        if (this.userInfoLoading) {
            const response = await this.userInfoLoading;
            if (response.user) {
                return response.user;
            }
            return undefined;
        }
        log.debug("Using fresh userInfo for", slackUserId);
        this.main.incRemoteCallCounter("users.info");
        this.userInfoLoading = rp({
            uri: 'https://slack.com/api/users.info',
            qs: {
                token: slackAccessToken,
                user: slackUserId,
            },
            json: true,
        });
        const response = await this.userInfoLoading;
        if (!response.user || !response.user.profile) {
            log.error("Failed to get user profile", response);
            return;
        }
        this.userInfoCache = response.user;
        setTimeout(() => this.userInfoCache = undefined, USER_CACHE_TIMEOUT);
        this.userInfoLoading = undefined;
        return response.user;
    }
    async updateAvatar(message, room) {
        const token = room.AccessToken;
        if (!token) {
            return;
        }
        let avatarUrl;
        if (message.bot_id) {
            avatarUrl = await this.getBotAvatarUrl(message.bot_id, token);
        }
        else if (message.user_id) {
            avatarUrl = await this.lookupAvatarUrl(message.user_id, token);
        }
        else {
            return;
        }
        if (this.avatarUrl === avatarUrl) {
            return;
        }
        const match = avatarUrl.match(/\/([^\/]+)$/);
        if (!match || !match[1]) {
            return;
        }
        const shortname = match[1];
        const response = await rp({
            uri: avatarUrl,
            resolveWithFullResponse: true,
            encoding: null,
        });
        const contentUri = await this.uploadContent({
            _content: response.body,
            title: shortname,
            mimetype: response.headers["content-type"],
        });
        await this.intent.setAvatarUrl(contentUri);
        this.avatarUrl = avatarUrl;
        this.main.putUserToStore(this);
    }
    prepareBody(body) {
        //TODO: This is fixing plaintext mentions, but should be refactored. See issue #110
        return body.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
    }
    prepareFormattedBody(body) {
        return Slackdown.parse(body);
    }
    sendText(roomId, text, slackRoomID, slackEventTS, extraContent) {
        // TODO: Slack's markdown is their own thing that isn't really markdown,
        // but the only parser we have for it is slackdown. However, Matrix expects
        // a variant of markdown that is in the realm of sanity. Currently text
        // will be slack's markdown until we've got a slack -> markdown parser.
        //TODO: This is fixing plaintext mentions, but should be refactored. See issue #110
        const body = text.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
        const extra = extraContent || {};
        const content = Object.assign({ body, msgtype: "m.text", formatted_body: Slackdown.parse(text), format: "org.matrix.custom.html" }, extra);
        return this.sendMessage(roomId, content, slackRoomID, slackEventTS);
    }
    async sendMessage(roomId, msg, slackRoomID, slackEventTS) {
        const matrixEvent = await this.intent.sendMessage(roomId, msg);
        this.main.incCounter("sent_messages", { side: "matrix" });
        const event = new matrix_appservice_bridge_1.StoredEvent(roomId, matrixEvent.event_id, slackRoomID, slackEventTS);
        await this.main.eventStore.upsertEvent(event);
        return matrixEvent;
    }
    async sendReaction(room_id, event_id, key, slackRoomId, slackEventTs) {
        const content = {
            "m.relates_to": {
                "event_id": event_id,
                "rel_type": "m.annotation",
                "key": key
            }
        };
        const matrixEvent = await this.intent.sendEvent(room_id, "m.reaction", content);
        // Add this event to the eventStore
        const event = new matrix_appservice_bridge_1.StoredEvent(room_id, matrixEvent.event_id, slackRoomId, slackEventTs);
        this.main.eventStore.upsertEvent(event);
        return matrixEvent;
    }
    async uploadContentFromURI(file, uri, slackAccessToken) {
        try {
            const buffer = await rp({
                uri: uri,
                headers: {
                    Authorization: `Bearer ${slackAccessToken}`,
                },
                encoding: null,
            });
            file._content = buffer;
            return await this.uploadContent(file);
        }
        catch (reason) {
            log.error("Failed to upload content:\n%s", reason);
            throw reason;
        }
    }
    async uploadContent(file) {
        const response = await this.intent.getClient().uploadContent({
            stream: new Buffer(file._content, "binary"),
            name: file.title,
            type: file.mimetype,
        });
        const content_uri = JSON.parse(response).content_uri;
        log.debug("Media uploaded to " + content_uri);
        return content_uri;
    }
    bumpATime() {
        this.atime = Date.now() / 1000;
    }
    get aTime() {
        return this.atime;
    }
}
exports.SlackGhost = SlackGhost;
