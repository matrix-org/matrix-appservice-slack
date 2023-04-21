import { ProvisioningClient, ProvisioningError } from './ProvisioningClient';

export interface GetLinkResponse {
    inbound_uri: string,
    isWebhook: boolean,
    matrix_room_id: string,
    slack_channel_id?: string,
    slack_channel_name?: string,
    slack_webhook_uri?: string,
    status: string,
    team_id?: string,
}

export interface SlackWorkspace {
    id: string,
    name: string,
    slack_id: string,
}

export interface SlackChannel {
    id: string,
    name: string,
    purpose?: { value: string },
    topic?: { value: string },
}

export interface LinkResponse {
    inbound_uri: string,
    matrix_room_id: string,
    slack_channel_name?: string,
    slack_webhook_uri?: string,
}

export interface LogoutResponse {
    deleted: boolean,
    msg?: string,
}

export class SlackProvisioningClient {
    constructor(
        readonly client: ProvisioningClient,
    ) {}

    getLink = async(roomId: string): Promise<GetLinkResponse> => {
        const res = await this.client.request(
            'POST',
            '/getlink',
            {
                matrix_room_id: roomId,
            },
        );
        return res as GetLinkResponse;
    };

    listWorkspaces = async(): Promise<SlackWorkspace[]> => {
        try {
            const res = await this.client.request(
                'POST',
                '/teams',
            );
            return (res as {
                teams: SlackWorkspace[]
            }).teams;
        } catch (e) {
            if (e instanceof ProvisioningError && e.errcode === 'SLACK_UNKNOWN_ACCOUNT') {
                return [];
            }
            throw e;
        }
    };

    listChannels = async(workspaceId: string): Promise<SlackChannel[]> => {
        const res = await this.client.request(
            'POST',
            '/channels',
            {
                team_id: workspaceId,
            },
        );
        return (res as {
            channels: SlackChannel[]
        }).channels;
    };

    link = async(
        roomId: string,
        workspaceId: string,
        channelId: string,
    ): Promise<LinkResponse> => {
        const res = await this.client.request(
            'POST',
            '/link',
            {
                matrix_room_id: roomId,
                channel_id: channelId,
                team_id: workspaceId,
            },
        );
        return res as LinkResponse;
    };

    unlink = async(roomId: string): Promise<void> => {
        await this.client.request(
            'POST',
            '/unlink',
            {
                matrix_room_id: roomId,
            },
        );
    };

    getAuthUrl = async(): Promise<string> => {
        const res = await this.client.request(
            'POST',
            '/authurl',
        );
        return (res as {
            auth_uri: string
        }).auth_uri;
    };

    logout = async(teamId: string, slackId: string): Promise<LogoutResponse> => {
        const res = await this.client.request(
            'POST',
            '/logout',
            {
                team_id: teamId,
                slack_id: slackId,
            },
        );

        return (res as {
            logoutResult: LogoutResponse
        }).logoutResult;
    };
}
