import { WebAPICallResult } from "@slack/web-api";
import { ISlackFile } from "./BaseSlackHandler";

/**
 * Taken from https://api.slack.com/methods/team.info
 */
export interface TeamInfoResponse extends WebAPICallResult {
    team: {
        id: string;
        name: string;
        domain: string;
    };
}

/**
 * Taken from https://api.slack.com/methods/conversations.info
 */
export interface ConversationsInfoResponse extends WebAPICallResult {
    channel: {
        id: string;
        name: string;
    };
}

/**
 * Taken from https://api.slack.com/methods/auth.test
 */
export interface AuthTestResponse extends WebAPICallResult {
    url: string;
    team: string;
    user: string;
    team_id: string;
    user_id: string;
}

/**
 * Taken from https://api.slack.com/methods/users.info
 */
export interface UsersInfoResponse extends WebAPICallResult {
    user: {
        id: string;
        name: string;
        team_id: string;
        profile: {
            bot_id?: string;
        }
    };
}

/**
 * Taken from https://api.slack.com/methods/oauth.access
 */
export interface OAuthAccessResponse extends WebAPICallResult {
    access_token: string;
    scope: string;
    team_name: string;
    team_id: string;
    bot?: {
        bot_user_id: string;
        bot_access_token: string;
    };
    user_id: string;
}

/**
 * Taken from https://api.slack.com/methods/conversations.list
 */
export interface ConversationsListResponse extends WebAPICallResult {
    channels: {
        id: string;
        name: string;
        purpose: string;
        topic: string;
    }[];
}

/**
 * Taken from https://api.slack.com/methods/bots.info
 */
export interface BotsInfoResponse extends WebAPICallResult {
    bot: {
        id: string;
        name: string;
        icons: {
            image_36?: string;
            image_48?: string;
            image_72?: string;
            image_original?: string;
            image_1024?: string;
            image_512?: string;
            image_192?: string;
        }
    };
}

/**
 * Taken from https://api.slack.com/methods/conversations.history
 */
export interface ConversationsHistoryResponse extends WebAPICallResult {
    messages: {
      type: string;
      subtype?: string;
      file?: ISlackFile;
      user: string;
      text: string;
      ts: string;
    }[];
}

/**
 * Taken from https://api.slack.com/methods/files.sharedPublicURL
 */
export interface FilesSharedPublicURLResponse extends WebAPICallResult {
    file: ISlackFile;
}
