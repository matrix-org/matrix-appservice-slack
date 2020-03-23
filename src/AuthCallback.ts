import axios, { AxiosRequestConfig } from "axios";

export interface AuthCallbackProvider {
    canLinkChannel(userId: string, slackTeamId: string, slackChannelId: string): Promise<boolean>;
    onLinkedChannel(userId: string, slackTeamId: string, slackChannelId: string): Promise<boolean>;
    canPuppetUser(userId: string, slackTeamId: string, slackUserId: string): Promise<boolean>;
    onPuppetUser(userId: string, slackTeamId: string, slackUserId: string): Promise<boolean>;
}

export const dummyAuthCallback: AuthCallbackProvider = {
    canLinkChannel: async () => true,
    onLinkedChannel: async () => true,
    canPuppetUser: async () => true,
    onPuppetUser: async () => true,
};

export class AuthCallback implements AuthCallbackProvider {
    private axiosConfig: AxiosRequestConfig;
    constructor(baseURL: string, secretToken: string) {
        this.axiosConfig = {
            headers: {
                Authorization: `Bearer ${secretToken}`,
            },
            baseURL,
        };
    }

    public async canLinkChannel(userId: string, slackTeamId: string, slackChannelId: string) {
        await axios.post(`/link/verify/${slackTeamId}-${slackChannelId}`, {
            userId,
            subject: {
                slackTeamId,
                slackChannelId,
            },
        }, this.axiosConfig);
        return true;
    }

    public async onLinkedChannel(userId: string, slackTeamId: string, slackChannelId: string) {
        await axios.put(`/link/${slackTeamId}-${slackChannelId}`, {
            userId,
            subject: {
                slackTeamId,
                slackChannelId,
            },
        }, this.axiosConfig);
        return true;
    }

    public async canPuppetUser(userId: string, slackTeamId: string, slackUserId: string) {
        await axios.post(`/puppet/verify/${slackTeamId}-${slackUserId}`, {
            userId,
            subject: {
                slackTeamId,
                slackUserId,
            },
        }, this.axiosConfig);
        return true;
    }

    public async onPuppetUser(userId: string, slackTeamId: string, slackUserId: string) {
        await axios.put(`/puppet/verify/${slackTeamId}-${slackUserId}`, {
            userId,
            subject: {
                slackTeamId,
                slackUserId,
            },
        }, this.axiosConfig);
        return true;
    }
}
