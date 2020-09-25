import escapeStringRegexp from "escape-string-regexp";

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

export interface AllowDenyConfigSimple {
    allow?: string[];
    deny?: string[];
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
        // Otherwise, it's a real regex. Remove the leading and trailing slash.
        return new RegExp(str.slice(1, str.length - 1));
    }

    private dmAllow?: {
        matrix: RegExp[];
        slack: RegExp[];
    };

    private dmDeny?: {
        matrix: RegExp[];
        slack: RegExp[];
    };

    private slackChannelAllow?: RegExp[];
    private slackChannelDeny?: RegExp[];

    constructor(dmConfig?: AllowDenyConfig, slackChannelConfig?: AllowDenyConfigSimple) {
        if (dmConfig?.allow) {
            this.dmAllow = {
                matrix: (dmConfig.allow.matrix || []).map(AllowDenyList.convertToRegex),
                slack: (dmConfig.allow.slack || []).map(AllowDenyList.convertToRegex)
            };
        }
        if (dmConfig?.deny) {
            this.dmDeny = {
                matrix: (dmConfig.deny.matrix || []).map(AllowDenyList.convertToRegex),
                slack: (dmConfig.deny.slack || []).map(AllowDenyList.convertToRegex)
            };
        }
        if (slackChannelConfig?.allow) {
            this.slackChannelAllow = slackChannelConfig.allow.map(AllowDenyList.convertToRegex);
        }
        if (slackChannelConfig?.deny) {
            this.slackChannelDeny = slackChannelConfig.deny.map(AllowDenyList.convertToRegex);
        }
    }

    /**
     * Test if a DM is allowed to go from Matrix to Slack
     * @param slackUser The Slack User ID
     * @param matrixUser The Matrix MXID
     */
    public allowDM(matrixUser: string, slackUser: string, slackUsername?: string): DenyReason {
        const allow = this.dmAllow;
        if (allow && allow.matrix?.length > 0 && !allow.matrix.some((e) => e.test(matrixUser))) {
            return DenyReason.MATRIX; // Matrix user was not on the allow list
        }
        if (allow && allow.slack?.length > 0 && !allow.slack.some((e) => e.test(slackUser) ||
            (slackUsername && e.test(slackUsername)))) {
            return DenyReason.SLACK; // Slack user was not on the allow list
        }
        const deny = this.dmDeny;
        if (deny && deny.matrix?.length > 0 && deny.matrix.some((e) => e.test(matrixUser))) {
            return DenyReason.MATRIX; // Matrix user was on the deny list
        }

        if (deny && deny.slack?.length > 0 && deny.slack.some((e) => e.test(slackUser) ||
            (slackUsername && e.test(slackUsername)))) {
            return DenyReason.SLACK; // Slack user was on the deny list
        }

        return DenyReason.ALLOWED;
    }

    /**
     * Check if a Slack channel can be bridged.
     * @param slackChannelId The Slack channel ID   e.g. CCZ41UJV7
     * @param slackChannelName The Slack channel name e.g. #general
     */
    public allowSlackChannel(slackChannelId: string, slackChannelName?: string): DenyReason.ALLOWED|DenyReason.SLACK {
        if (slackChannelName?.startsWith('#')) {
            slackChannelName = slackChannelName.slice(1);
        }

        // Test against both general and #general.
        const testSlackChannel = (regex: RegExp) =>
            regex.test(slackChannelId) || (slackChannelName && (regex.test(slackChannelName) || regex.test(`#${slackChannelName}`)));

        const allow = this.slackChannelAllow;
        if (allow && allow.length > 0 && !allow.some(testSlackChannel)) {
            return DenyReason.SLACK;
        }

        const deny = this.slackChannelDeny;
        if (deny && deny.length > 0 && deny.some(testSlackChannel)) {
            return DenyReason.SLACK;
        }

        return DenyReason.ALLOWED;
    }
}
