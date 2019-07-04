import { Logging } from "matrix-appservice-bridge";
import * as rp from "request-promise-native";

import { Main } from "./Main";
import { SlackGhost } from "./SlackGhost";
import { default as subs } from "./substitutions";

const log = Logging.get("BaseSlackHandler");

const CHANNEL_ID_REGEX = /<#(\w+)\|?\w*?>/g;
const CHANNEL_ID_REGEX_FIRST = /<#(\w+)\|?\w*?>/;

// (if the message is an emote, the format is <@ID|nick>, but in normal msgs it's just <@ID>
const USER_ID_REGEX = /<@(\w+)\|?\w*?>/g;
const USER_ID_REGEX_FIRST = /<@(\w+)\|?\w*?>/;

export interface ISlackMessage {
    channel: string;
    text?: string;
}

export abstract class BaseSlackHandler {
    constructor(protected main: Main) { }

    public async replaceChannelIdsWithNames(message: ISlackMessage, token: string): Promise<ISlackMessage> {
        if (message.text === undefined) {
            return message;
        }
        const testForName = message.text.match(CHANNEL_ID_REGEX);
        let iteration = 0;
        let matches = 0;
        
        if (testForName && testForName.length) {
            matches = testForName.length;
        } else {
            return message;
        }
        while (iteration < matches) {
            const idMatch = testForName[iteration].match(CHANNEL_ID_REGEX_FIRST);
            if (idMatch === null) {
                iteration++;
                continue;
            }
            let channel = idMatch[1];
            const channelsInfoApiParams = {
                uri: 'https://slack.com/api/channels.info',
                qs: {
                    token: token,
                    channel
                },
                json: true
            };
            this.main.incRemoteCallCounter("channels.info");
            try {
                const response = await rp(channelsInfoApiParams);
                let name = channel;
                if (response && response.channel && response.channel.name) {
                    name = response.channel.name;
                    log.info(`channels.info: ${channel} mapped to ${name}`);
                } else {
                    log.info("channels.info returned no result for " + channel);
                }
                message.text = message.text.replace(CHANNEL_ID_REGEX_FIRST, `#${name}`);
            } catch (ex) {
                log.error("Caught error handling channels.info:" + ex);
            } finally {
                iteration++;
            }
        }
        return message;
    }

    public async replaceUserIdsWithNames(message: ISlackMessage, token: string): Promise<ISlackMessage> {
        if (message.text === undefined) {
            return message;
        }
    
        let match = USER_ID_REGEX.exec(message.text);
        while (match !== null && match[0]) {
            // foreach userId, pull out the ID
            // (if this is an emote msg, the format is <@ID|nick>, but in normal msgs it's just <@ID>
            const id = match[0].match(USER_ID_REGEX_FIRST)![1];
    
            const team_domain = await this.main.getTeamDomainForMessage(message);
    
            let display_name = "";
            let user_id = this.main.getUserId(id, team_domain);
    
            const store = this.main.userStore
            const users = await store.select({id: user_id});
    
            if (users === undefined || !users.length) {
                log.warn("Mentioned user not in store. Looking up display name from slack.");
                // if the user is not in the store then we look up the displayname
                const nullGhost = new SlackGhost(this.main);
                const room = this.main.getRoomBySlackChannelId(message.channel);
                display_name = await nullGhost.getDisplayname(id, room!.AccessToken!) || id;
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
    public enablePublicSharing(file: any, token: string) {
        if (file.public_url_shared) return Promise.resolve(file);

        this.main.incRemoteCallCounter("files.sharedPublicURL");
        return rp({
            method: 'POST',
            form: {
                file: file.id,
                token: token,
            },
            uri: "https://slack.com/api/files.sharedPublicURL",
            json: true
        }).then((response: any) => {
            if (!response || !response.file || !response.file.permalink_public) {
                log.warn("Could not find sharedPublicURL: " + JSON.stringify(response));
                return;
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
    public async fetchFileContent(file: any, token: string) {
        if (!file) return Promise.resolve();

        const url = subs.getSlackFileUrl(file) || file.permalink_public;
        if (!url) {
            throw "File doesn't have any URLs we can use.";
        }
    
        const response = await rp({
            uri: url,
            resolveWithFullResponse: true,
            encoding: null
        });
        
        const content = response.body;
        log.debug("Successfully fetched file " + file.id +
            " content (" + content.length + " bytes)");
        return content;
    }
}