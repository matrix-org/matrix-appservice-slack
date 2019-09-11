import { Datastore, TeamEntry } from "./datastore/Models";
import { WebClient, WebClientOptions } from "@slack/web-api";
import { Logging } from "matrix-appservice-bridge";
import { TeamInfoResponse, AuthTestResponse } from "./SlackResponses";

const webLog = Logging.get("slack-api");
const log = Logging.get("SlackClientFactory");

/**
 * This class holds clients for slack teams and individuals users
 * who are puppeting their accounts.
 */

interface RequiredConfigOptions {
    slack_client_opts?: WebClientOptions;
}

export class SlackClientFactory {
    private teamClients: Map<string, WebClient> = new Map();
    private puppets: Map<string, WebClient> = new Map();
    constructor(private datastore: Datastore, private config: RequiredConfigOptions, private onRemoteCall: (method: string) => void) {

    }

    /**
     * Gets a team entry from the datastore and checks if the token
     * is safe to use.
     * @param teamId The slack teamId to check.
     */
    public async isTeamStatusOkay(teamId: string): Promise<boolean> {
        const storedTeam = await this.datastore.getTeam(teamId);
        if (!storedTeam) {
            log.warn(`Team ${teamId} is not ready: No team found in store`);
            return false;
        }
        if (storedTeam.status === "bad_auth") {
            log.warn(`Team ${teamId} is not ready: Team previously failed to auth and has been disabled`);
            return false;
        }
        if (storedTeam.status === "archived") {
            log.warn(`Team ${teamId} is not ready: Team is archived.`);
            return false;
        }
        if (!storedTeam.bot_token) {
            log.warn(`Team ${teamId} is not ready: No token stored.`);
            return false;
        }
        return true;
    }

    /**
     * Gets a WebClient for a given teamId. If one has already been
     * created, the cached client is returned.
     * This may tho
     * @param teamId The slack team_id.
     * @throws If the team token is unauthorized.
     */
    public async getTeamClient(teamId: string): Promise<WebClient> {
        if (this.teamClients.has(teamId)) {
            return this.teamClients.get(teamId)!;
        }
        const storedTeam = await this.datastore.getTeam(teamId);
        if (!storedTeam) {
            throw Error("No team found in store");
        }
        // Check that the team is actually usable.
        if (!await this.isTeamStatusOkay(teamId)) {
            throw Error("Team status is not okay");
        }
        // This exists because the previous statement passed.
        const teamEntry = (await this.datastore.getTeam(teamId))!;
        log.info("Creating new team client for", teamId);
        try {
            const { slackClient, team } = await this.createTeamClient(teamEntry.bot_token!);
            // Call this to get our identity.
            const testRes = (await slackClient.auth.test()) as AuthTestResponse;
            teamEntry.domain = team.domain;
            teamEntry.name = team.name;
            teamEntry.user_id = testRes.user_id;
            teamEntry.status = "ok";
            this.teamClients.set(teamId, slackClient);
            return slackClient;
        } catch (ex) {
            log.warn(`Failed to authenticate for ${teamId}`, ex);
            // This team was previously working at one point, and now
            // isn't.
            teamEntry.status = "bad_auth";
            throw ex;
        } finally {
            log.info(`Team status is ${teamEntry.status}`);
            await this.datastore.upsertTeam(teamEntry);
        }
    }

    /**
     * Checks a token, and inserts the team into the database if
     * the team exists.
     * @param token A Slack access token for a bot
     * @returns The teamId of the owner team
     */
    public async upsertTeamByToken(token: string): Promise<string> {
        let teamRes: {id: string, name: string, domain: string};
        let testRes: AuthTestResponse;
        let existingTeam: TeamEntry|undefined;
        try {
            const { slackClient, team } = await this.createTeamClient(token);
            // Call this to get our identity.
            testRes = (await slackClient.auth.test()) as AuthTestResponse;
            teamRes = team;
            const potentialTeam = await this.datastore.getTeam(team.id);
            if (potentialTeam) {
                existingTeam = potentialTeam;
            }
        } catch (ex) {
            log.warn(`Failed to authenticate`, ex);
            throw ex;
        }
        const teamEntry: TeamEntry = existingTeam || {
            id: teamRes!.id,
            scopes: "", // Unknown
            domain: teamRes!.domain,
            name: teamRes!.name,
            user_id: testRes.user_id,
            status: "ok",
            bot_token: token,
        };
        teamEntry.domain = teamRes!.domain;
        teamEntry.name = teamRes!.name;
        teamEntry.user_id = testRes.user_id;
        teamEntry.status = "ok";
        teamEntry.bot_token = token;
        await this.datastore.upsertTeam(teamEntry);
        return teamRes!.id;

    }

    public async getClientForUser(teamId: string, matrixUser: string): Promise<WebClient|null> {
        const key = `${teamId}:${matrixUser}`;
        if (this.puppets.has(key)) {
            return this.puppets.get(key) || null;
        }
        const token = await this.datastore.getPuppetTokenByMatrixId(teamId, matrixUser);
        if (!token) {
            return null;
        }
        const client = new WebClient(token);
        try {
            await client.auth.test();
        } catch (ex) {
            log.warn("Failed to auth puppeted client for user:", ex);
            return null;
        }
        this.puppets.set(key, client);
        return client;
    }

    private async createTeamClient(token: string) {
        const opts = this.config.slack_client_opts;
        const slackClient = new WebClient(token, {
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
            ...opts,
        });
        try {
            const teamInfo = (await slackClient.team.info()) as TeamInfoResponse;
            log.debug("Created new team client", teamInfo.team);
            return { slackClient, team: teamInfo.team };
        } catch (ex) {
            throw Error("Could not create team client: " + ex.data.error);
        }
    }
}
