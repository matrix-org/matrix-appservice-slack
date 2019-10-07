import { Datastore, TeamEntry } from "./datastore/Models";
import { WebClient, WebClientOptions, LogLevel } from "@slack/web-api";
import { Logging } from "matrix-appservice-bridge";
import { TeamInfoResponse, AuthTestResponse, BotsInfoResponse, UsersInfoResponse } from "./SlackResponses";

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
    private puppets: Map<string, {client: WebClient, id: string}> = new Map();
    constructor(private datastore: Datastore, private config?: RequiredConfigOptions, private onRemoteCall?: (method: string) => void) {

    }

    /**
     * Gets a team entry from the datastore and checks if the token
     * is safe to use.
     * @param teamId The slack teamId to check.
     * @throws If the team is not safe to use
     */
    public async isTeamStatusOkay(teamId: string) {
        const storedTeam = await this.datastore.getTeam(teamId);
        if (!storedTeam) {
            throw Error(`Team ${teamId} is not ready: No team found in store`);
        }
        if (storedTeam.status === "bad_auth") {
            throw Error(`Team ${teamId} is not usable: Team previously failed to auth and is disabled`);
        }
        if (storedTeam.status === "archived") {
            throw Error(`Team ${teamId} is not usable: Team is archived`);
        }
        if (!storedTeam.bot_token) {
            throw Error(`Team ${teamId} is not usable: No token stored`);
        }
    }

    /**
     * Gets a WebClient for a given teamId. If one has already been
     * created, the cached client is returned.
     * @param teamId The slack team_id.
     * @throws If the team client fails to be created.
     */
    public async getTeamClient(teamId: string): Promise<WebClient> {
        if (this.teamClients.has(teamId)) {
            return this.teamClients.get(teamId)!;
        }
        const teamEntry = await this.datastore.getTeam(teamId);
        if (!teamEntry) {
            throw Error(`No team found in store for ${teamId}`);
        }
        // Check that the team is actually usable.
        await this.isTeamStatusOkay(teamId);

        log.info("Creating new team client for", teamId);
        try {
            const { slackClient, team, user } = await this.createTeamClient(teamEntry.bot_token!);
            // Call this to get our identity.
            teamEntry.domain = team.domain;
            teamEntry.name = team.name;
            teamEntry.bot_id = user.user!.profile!.bot_id!;
            teamEntry.user_id = user.user!.id!;
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
            log.debug(`Team status is ${teamEntry.status}`);
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
        let botId: string;
        let userId: string;
        try {
            const { team , auth, user} = await this.createTeamClient(token);
            // Call this to get our identity.
            userId = auth.user_id;
            botId = user.user!.profile!.bot_id!;
            teamRes = team;
        } catch (ex) {
            log.warn(`Failed to authenticate`, ex);
            throw ex;
        }
        const existingTeam = (await this.datastore.getTeam(teamRes.id));
        const teamEntry: TeamEntry = {
            id: teamRes!.id,
            scopes: existingTeam ? existingTeam.scopes : "", // Unknown
            domain: teamRes!.domain,
            name: teamRes!.name,
            user_id: userId,
            bot_id: botId,
            status: "ok",
            bot_token: token,
        };
        await this.datastore.upsertTeam(teamEntry);
        return teamRes!.id;
    }

    public async getClientForUserWithId(teamId: string, matrixUser: string): Promise<{client: WebClient, id: string}|null> {
        const key = `${teamId}:${matrixUser}`;
        if (this.puppets.has(key)) {
            return this.puppets.get(key) || null;
        }
        const token = await this.datastore.getPuppetTokenByMatrixId(teamId, matrixUser);
        if (!token) {
            return null;
        }
        const client = new WebClient(token);
        let id: string;
        try {
            const res = (await client.auth.test()) as AuthTestResponse;
            id = res.user_id;
        } catch (ex) {
            log.warn("Failed to auth puppeted client for user:", ex);
            return null;
        }
        this.puppets.set(key, {id, client});
        return {id, client};
    }

    public async getClientForUser(teamId: string, matrixUser: string): Promise<WebClient|null> {
        const res = await this.getClientForUserWithId(teamId, matrixUser);
        return res !== null ? res.client : null;
    }

    private async createTeamClient(token: string) {
        const opts = this.config ? this.config.slack_client_opts : undefined;
        const slackClient = new WebClient(token, {
            logger: {
                getLevel: () => LogLevel.DEBUG,
                setLevel: () => {}, // We don't care about these.
                setName: () => {},
                debug: (msg: string) => {
                    // non-ideal way to detect calls to slack.
                    webLog.debug.bind(webLog);
                    if (!this.onRemoteCall) { return; }
                    const match = /apiCall\('([\w\.]+)'\) start/.exec(msg);
                    if (match && match[1]) {
                        this.onRemoteCall(match[1]);
                    }
                    webLog.debug(msg);
                },
                warn: webLog.warn.bind(webLog),
                info: webLog.info.bind(webLog),
                error: webLog.error.bind(webLog),
            },
            logLevel: LogLevel.DEBUG,
            ...opts,
        });
        try {
            const teamInfo = (await slackClient.team.info()) as TeamInfoResponse;
            const auth = (await slackClient.auth.test()) as AuthTestResponse;
            const user = (await slackClient.users.info({user: auth.user_id})) as UsersInfoResponse;
            log.debug("Created new team client for", teamInfo.team.name);
            return { slackClient, team: teamInfo.team, auth, user };
        } catch (ex) {
            throw Error("Could not create team client: " + ex.data.error);
        }
    }
}
