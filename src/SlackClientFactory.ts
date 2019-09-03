import { Datastore } from "./datastore/Models";
import { WebClient } from "@slack/web-api";
import { IConfig } from "./IConfig";
import { Logging } from "matrix-appservice-bridge";
import { TeamInfoResponse } from "./SlackResponses";
import { ISlackMessageEvent } from "./BaseSlackHandler";

const webLog = Logging.get("slack-api");
const log = Logging.get("SlackClientFactory");

/**
 * This class holds clients for slack teams and individuals users
 * who are puppeting their accounts.
 */
export class SlackClientFactory {
    private teamClients: Map<string, WebClient> = new Map();
    private puppets: Map<string, WebClient> = new Map();
    constructor(private datastore: Datastore, private config: IConfig, private onRemoteCall: (method: string) => void) {

    }

    public async createOrGetTeamClient(teamId: string, token: string): Promise<WebClient> {
        if (this.teamClients.has(teamId)) {
            return this.teamClients.get(teamId)!;
        }
        return (await this.createTeamClient(token)).slackClient;
    }

    public async createTeamClient(token: string) {
        const opts = this.config.slack_client_opts;
        const slackClient = new WebClient(token, {
            ...opts,
            logger: {
                setLevel: () => {}, // We don't care about these.
                setName: () => {},
                debug: (msg: any[]) => {
                    // non-ideal way to detect calls to slack.
                    webLog.debug.bind(webLog);
                    const match = /apiCall\('([\w\.]+)'\) start/.exec(msg[0]);
                    if (match && match[1]) {
                        this.onRemoteCall(match[1]);
                    }
                },
                warn: webLog.warn.bind(webLog),
                info: webLog.info.bind(webLog),
                error: webLog.error.bind(webLog),
            },
        });
        const teamInfo = (await slackClient.team.info()) as TeamInfoResponse;
        if (!teamInfo.ok) {
            throw Error("Could not create team client: " + teamInfo.error);
        }
        this.teamClients.set(teamInfo.team.id, slackClient);
        return { slackClient, team: teamInfo.team };
    }

    public getTeamClient(teamId: string): WebClient|undefined {
        return this.teamClients.get(teamId);
    }

    public async getClientForUser(teamId: string, slackUser: string): Promise<WebClient|undefined> {
        const key = `${teamId}:${slackUser}`;
        if (this.puppets.has(key)) {
            return this.puppets.get(key);
        }
        const token = await this.datastore.getPuppetTokenBySlackId(teamId, slackUser);
        if (!token) {
            return;
        }
        const client = new WebClient(token);
        try {
            await client.auth.test();
        } catch (ex) {
            log.warn("Failed to get puppeted client for user:", ex);
            return;
        }
        this.puppets.set(key, client);
        return client;
    }
}
