import { Main } from "./Main";
import { Logging, StoredEvent, Intent } from "matrix-appservice-bridge";
import * as rp from "request-promise-native";
import * as Slackdown from "Slackdown";
import { BridgedRoom } from "./BridgedRoom";

const log = Logging.get("SlackGhost");

// How long in milliseconds to cache user info lookups.
const USER_CACHE_TIMEOUT = 10 * 60 * 1000;  // 10 minutes

interface ISlackUser {
    profile?: {
        display_name?: string;
        real_name?: string;
        image_original?: string;
        image_1024?: string;
        image_512?: string;
        image_192?: string;
        image_72?: string;
        image_48?: string;
    };
}

interface ISlackFile {
    title: string;
    _content: string;
    mimetype: string;
}

interface ISlackGhostEntry {
    id?: string;
    display_name?: string;
    avatar_url?: string;
}

export class SlackGhost {

    public get aTime() {
        return this.atime;
    }

    public static fromEntry(main: Main, entry: ISlackGhostEntry, intent: Intent) {
        return new SlackGhost(
            main,
            entry.id,
            entry.display_name,
            entry.avatar_url,
            intent,
        );
    }
    private atime?: number;
    private userInfoCache?: ISlackUser;
    private userInfoLoading?: rp.RequestPromise<{user?: ISlackUser}>;
    constructor(
        private main: Main,
        private userId?: string,
        private displayName?: string,
        private avatarUrl?: string,
        public readonly intent?: Intent) {
    }

    public toEntry(): ISlackGhostEntry {
        return {
            avatar_url: this.avatarUrl,
            display_name: this.displayName,
            id: this.userId,
        };
    }

    public async update(message: {user_id?: string}, room: BridgedRoom) {
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

    public async getDisplayname(slackUserId: string, slackAccessToken: string) {
        const user = await this.lookupUserInfo(slackUserId, slackAccessToken);
        if (user && user.profile) {
            return user.profile.display_name || user.profile.real_name;
        }
    }

    public async updateDisplayname(message: {username?: string, user_name?: string, bot_id?: string, user_id?: string},
                                   room: BridgedRoom) {
        const token = room.AccessToken;
        if (!token) {
            return;
        }

        let displayName = message.username || message.user_name;

        if (message.bot_id) {
            displayName = await this.getBotName(message.bot_id, room.AccessToken!);
        } else if (message.user_id) {
            displayName = await this.getDisplayname(message.user_id, token);

        }

        if (!displayName || this.displayName === displayName) {
            return; // Nothing to do.
        }

        await this.intent.setDisplayName(displayName);
        this.displayName = displayName;
        return this.main.putUserToStore(this);
    }

    public async lookupAvatarUrl(slackUserId: string, slackAccessToken: string) {
        const user = await this.lookupUserInfo(slackUserId, slackAccessToken);
        if (!user || !user.profile) { return; }
        const profile = user.profile;

        // Pick the original image if we can, otherwise pick the largest image
        // that is defined
        return profile.image_original ||
            profile.image_1024 || profile.image_512 || profile.image_192 ||
            profile.image_72 || profile.image_48;
    }

    public async getBotInfo(bot: string, token: string) {
        if (!token) { return; }

        this.main.incRemoteCallCounter("bots.info");
        return await rp({
            json: true,
            qs: {
                bot,
                token,
            },
            uri: "https://slack.com/api/bots.info",
        });
    }

    public async getBotName(botId: string, token: string) {
        const response = await this.getBotInfo(botId, token);
        if (!response.bot || !response.bot.name) {
            log.error("Failed to get bot name", response);
            return;
        }
        return response.bot.name;
    }

    public async getBotAvatarUrl(botId: string, token: string) {
        const response = await this.getBotInfo(botId, token);
        if (!response.bot || !response.bot.icons.image_72) {
            log.error("Failed to get bot name", response);
            return;
        }
        const icons = response.bot.icons;
        return icons.image_original || icons.image_1024 || icons.image_512 ||
            icons.image_192 || icons.image_72 || icons.image_48;
    }

    public async lookupUserInfo(slackUserId: string, slackAccessToken: string) {
        if (this.userInfoCache) {
            log.debug("Using cached userInfo for", slackUserId);
            return this.userInfoCache;
        }
        if (this.userInfoLoading) {
            const existingReq = await this.userInfoLoading;
            if (existingReq.user) {
                return existingReq.user;
            }
            return;
        }
        log.debug("Using fresh userInfo for", slackUserId);

        this.main.incRemoteCallCounter("users.info");
        this.userInfoLoading = rp({
            json: true,
            qs: {
                token: slackAccessToken,
                user: slackUserId,
            },
            uri: "https://slack.com/api/users.info",
        }) as rp.RequestPromise<{user?: ISlackUser}>;
        const response = await this.userInfoLoading!;
        if (!response.user || !response.user.profile) {
            log.error("Failed to get user profile", response);
            return;
        }
        this.userInfoCache = response.user;
        setTimeout(() => this.userInfoCache = undefined, USER_CACHE_TIMEOUT);
        this.userInfoLoading = undefined;
        return response.user!;
    }

    public async updateAvatar(message: {bot_id?: string, user_id?: string}, room: BridgedRoom) {
        const token = room.AccessToken;
        if (!token) {
            return;
        }

        let avatarUrl;
        if (message.bot_id) {
            avatarUrl = await this.getBotAvatarUrl(message.bot_id, token);
        } else if (message.user_id) {
            avatarUrl = await this.lookupAvatarUrl(message.user_id, token);
        } else {
            return;
        }

        if (this.avatarUrl === avatarUrl) {
            return;
        }

        const match = avatarUrl.match(/\/([^\/]+)$/);
        if (!match || !match[1]) {
            return;
        }

        const title = match[1];

        const response = await rp({
            encoding: null,
            resolveWithFullResponse: true,
            uri: avatarUrl,
        });
        const contentUri = await this.uploadContent({
            _content: response.body,
            mimetype: response.headers["content-type"],
            title,
        });
        await this.intent.setAvatarUrl(contentUri);
        this.avatarUrl = avatarUrl;
        this.main.putUserToStore(this);
    }

    public prepareBody(body: string) {
        // TODO: This is fixing plaintext mentions, but should be refactored. See issue #110
        return body.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
    }

    public prepareFormattedBody(body: string) {
        return Slackdown.parse(body);
    }

    public async sendText(roomId: string, text: string, slackRoomID: string, slackEventTS: string, extra: {} = {}) {
        // TODO: Slack's markdown is their own thing that isn't really markdown,
        // but the only parser we have for it is slackdown. However, Matrix expects
        // a variant of markdown that is in the realm of sanity. Currently text
        // will be slack's markdown until we've got a slack -> markdown parser.

        // TODO: This is fixing plaintext mentions, but should be refactored. See issue #110
        const body = text.replace(/<https:\/\/matrix\.to\/#\/@.+:.+\|(.+)>/g, "$1");
        const content = {
            body,
            format: "org.matrix.custom.html",
            formatted_body: Slackdown.parse(text),
            msgtype: "m.text",
            ...extra,
        };
        return this.sendMessage(roomId, content, slackRoomID, slackEventTS);
    }

    public async sendMessage(roomId: string, msg: {}, slackRoomID: string, slackEventTS: string) {
        const matrixEvent = await this.intent.sendMessage(roomId, msg);
        this.main.incCounter("sent_messages", {side: "matrix"});

        const event = new StoredEvent(roomId, matrixEvent.event_id, slackRoomID, slackEventTS);
        await this.main.eventStore.upsertEvent(event);

        return matrixEvent;
    }

    public async sendReaction(roomId: string, eventId: string, key: string,
                              slackRoomId: string, slackEventTs: string) {
        const content = {
            "m.relates_to": {
                event_id: eventId,
                key,
                rel_type: "m.annotation",
            },
        };

        const matrixEvent = await this.intent.sendEvent(roomId, "m.reaction", content);

        // Add this event to the eventStore
        const event = new StoredEvent(roomId, matrixEvent.event_id, slackRoomId, slackEventTs);
        this.main.eventStore.upsertEvent(event);

        return matrixEvent;
    }

    public async uploadContentFromURI(file: ISlackFile, uri: string, slackAccessToken: string) {
        try {
            const buffer = await rp({
                encoding: null, // Because we expect a binary
                headers: {
                    Authorization: `Bearer ${slackAccessToken}`,
                },
                uri,
            });
            file._content = buffer;
            return await this.uploadContent(file);
        } catch (reason) {
            log.error("Failed to upload content:\n%s", reason);
            throw reason;
        }
    }

    public async uploadContent(file: ISlackFile) {
        const response = await this.intent.getClient().uploadContent({
            name: file.title,
            stream: new Buffer(file._content, "binary"),
            type: file.mimetype,
        });
        const content_uri = JSON.parse(response).content_uri;
        log.debug("Media uploaded to " + content_uri);
        return content_uri;
    }

    public bumpATime() {
        this.atime = Date.now() / 1000;
    }
}
