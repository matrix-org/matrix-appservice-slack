import { WebAPICallResult } from "@slack/web-api";

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
