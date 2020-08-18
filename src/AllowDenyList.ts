import * as escapeStringRegexp from "escape-string-regexp";

export interface AllowDenyConfig {
    allow?: {
        slack?: string[];
        matrix?: string[];
    },
    deny?: {
        slack?: string[];
        matrix?: string[];
    }
}

export enum DenyReason {
    ALLOWED,
    MATRIX,
    SLACK,
}

export class AllowDenyList {

    private static convertToRegex(str: string) {
        if (!str.startsWith("/") || !str.endsWith("/")) {
            // NOTE: String will still need to be escaped
            str = escapeStringRegexp(str);
            // Ensure the exact string matches.
            return new RegExp(`^${str}$`);
        }
        // Otherwise, it's a real regex
        return new RegExp(str);
    }

    private allow?: {
        matrix: RegExp[];
        slack: RegExp[];
    };
    private deny?: {
        matrix: RegExp[];
        slack: RegExp[];
    }

    constructor(config: AllowDenyConfig = {}) {
        if (config.allow) {
            this.allow = {
                matrix: (config.allow.matrix || []).map(AllowDenyList.convertToRegex),
                slack: (config.allow.slack || []).map(AllowDenyList.convertToRegex)
            };
        }
        if (config.deny) {
            this.deny = {
                matrix: (config.deny.matrix || []).map(AllowDenyList.convertToRegex),
                slack: (config.deny.slack || []).map(AllowDenyList.convertToRegex)
            };
        }
    }

    /**
     * Test if a DM is allowed to go from Matrix to Slack
     * @param slackUser The Slack User ID
     * @param matrixUser The Matrix MXID
     */
    public allowDM(matrixUser: string, slackUser: string, slackUsername?: string): DenyReason {
        const allow = this.allow;
        if (allow && allow.matrix?.length > 0 && !allow.matrix.find((e) => e.test(matrixUser))) {
            return DenyReason.MATRIX; // Matrix user was not on the allow list
        }
        if (allow && allow.slack?.length > 0 && !allow.slack.find((e) => e.test(slackUser) || 
            (slackUsername && e.test(slackUsername)))) {
            return DenyReason.SLACK; // Slack user was not on the allow list
        }

        const deny = this.deny;
        if (deny && deny.matrix?.length > 0 && deny.matrix.find((e) => e.test(matrixUser))) {
            return DenyReason.MATRIX; // Matrix user was not on the allow list
        }

        if (deny && deny.slack?.length > 0 && deny.slack.find((e) => e.test(slackUser) || 
            (slackUsername && e.test(slackUsername)))) {
            return DenyReason.SLACK; // Slack user was not on the allow list
        }

        return DenyReason.ALLOWED;
    }
} 