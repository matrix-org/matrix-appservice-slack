import { WebAPICallResult } from "@slack/web-api";
import { ISlackFile, ISlackUser, ISlackMessageEvent } from "./BaseSlackHandler";

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
    channel: ConversationsInfo;
}

/**
 * Taken from https://api.slack.com/methods/conversations.info
 */
export interface ConversationsOpenResponse extends ConversationsInfoResponse {
    no_op: boolean;
    already_open: boolean;
    channel: ConversationsInfo;
}

/**
 * Taken from https://api.slack.com/methods/conversations.members
 */
export interface ConversationsMembersResponse extends WebAPICallResult {
    members: string[];
    response_metadata: {
        next_cursor: string;
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
    user?: ISlackUser;
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
    channels: ConversationsInfo[];
    response_metadata: {
        next_cursor: string;
    };
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
    messages: ISlackMessageEvent[];
}

/**
 * Taken from https://api.slack.com/methods/files.sharedPublicURL
 */
export interface FilesSharedPublicURLResponse extends WebAPICallResult {
    file: ISlackFile;
}

/**
 * Taken from https://api.slack.com/methods/chat.update
 */
export interface ChatUpdateResponse extends WebAPICallResult {
    ts: string;
    channel: string;
    text: string;
}

/**
 * Taken from https://api.slack.com/methods/chat.postMessage
 */
export interface ChatPostMessageResponse extends WebAPICallResult {
    ts: string;
    channel: string;
}

/**
 * Taken from https://api.slack.com/methods/users.list
 */
export interface UsersListResponse extends WebAPICallResult {
    members: ISlackUser[];
    response_metadata: {
        next_cursor: string;
    };
}

export interface ConversationsInfo {
    id: string;
    name: string;
    creator: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_group?: boolean;
    is_channel?: boolean;
    is_private?: boolean;
    /**
     * Other user in the DM. Only applies to DMs
     */
    user?: string;
    topic?: {
        value: string;
    };
    purpose?: {
        value: string;
    };
}

/**
 * Taken from https://api.slack.com/methods/files.info
 */
export interface FileInfoResponse extends WebAPICallResult {
    file: ISlackFile,
}