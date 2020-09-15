import { SlackRoomStore } from "./SlackRoomStore";
import { Datastore } from "./datastore/Models";
import { SlackGhost } from "./SlackGhost";
import { IConfig } from "./IConfig";
import * as QuickLRU from "quick-lru";
import { Logging, Bridge } from "matrix-appservice-bridge";

const log = Logging.get("SlackGhostStore");

/**
 * Class that supports the creation of slack ghosts.
 */
export class SlackGhostStore {
    private ghostsByUserId: QuickLRU<string, SlackGhost>;

    constructor(private rooms: SlackRoomStore, private datastore: Datastore, private config: IConfig, private bridge: Bridge) {
        // XXX: Use cache value from config.
        this.ghostsByUserId = new QuickLRU({ maxSize: 50 });
    }

    public get cached() { return this.ghostsByUserId; }

    /**
     * Get the domain of a message by getting it from it's keys, or by resolving the teamId.
     * @param message The slack message, containing a team_domain.
     * @param teamId Optionally pass the teamId, if known.
     */
    public async getTeamDomainForMessage(message: {team_domain?: string}, teamId?: string): Promise<string> {
        // TODO: Is the correct home for this function?
        if (message.team_domain !== undefined) {
            return message.team_domain;
        }

        if (!teamId) {
            throw Error("Cannot determine team, no id given.");
        }

        const team = await this.datastore.getTeam(teamId!);
        if (team) {
            return team.domain;
        } else {
            throw Error("Cannot determine team, no team found for ID.");
        }
    }

    public async getNullGhostDisplayName(channel: string, userId: string): Promise<string> {
        const room = this.rooms.getBySlackChannelId(channel);
        const nullGhost = new SlackGhost(this.datastore, userId, room!.SlackTeamId!, userId, undefined);
        if (!room || !room.SlackClient) {
            return userId;
        }
        return (await nullGhost.getDisplayname(room!.SlackClient!)) || userId;
    }

    public getUserId(id: string, teamDomain: string): string {
        const localpart = `${this.config.username_prefix}${teamDomain.toLowerCase()}_${id.toUpperCase()}`;
        return `@${localpart}:${this.config.homeserver.server_name}`;
    }

    public async getForSlackMessage(message: {team_domain?: string, user_id: string}, teamId?: string): Promise<SlackGhost> {
        // Slack ghost IDs need to be constructed from user IDs, not usernames,
        // because users can change their names
        // TODO if the team_domain is changed, we will recreate all users.
        // TODO(paul): Steal MatrixIdTemplate from matrix-appservice-gitter

        // team_domain is gone, so we have to actually get the domain from a friendly object.
        const teamDomain = (await this.getTeamDomainForMessage(message, teamId)).toLowerCase();
        return this.get(message.user_id, teamDomain, teamId);
    }

    public async get(slackUserId: string, teamDomain?: string, teamId?: string): Promise<SlackGhost> {
        if (!teamDomain && !teamId) {
            throw Error("Must provide either a teamDomain or a teamId");
        }

        const domain = teamDomain || await this.getTeamDomainForMessage({}, teamId);

        const userId = this.getUserId(
            slackUserId,
            domain,
        );
        const existing = this.ghostsByUserId.get(userId);
        if (existing) {
            log.debug("Getting existing ghost from cache for", userId);
            return existing;
        }

        const intent = this.bridge.getIntent(userId);
        const entry = await this.datastore.getUser(userId);
        await intent._ensureRegistered();

        let ghost: SlackGhost;
        if (entry) {
            log.debug("Getting existing ghost for", userId);
            ghost = SlackGhost.fromEntry(this.datastore, entry, intent);
        } else {
            log.debug("Creating new ghost for", userId);
            ghost = new SlackGhost(
                this.datastore,
                slackUserId,
                teamId,
                userId,
                intent,
            );
            await this.datastore.upsertUser(ghost);
        }

        this.ghostsByUserId.set(userId, ghost);
        return ghost;
    }

    public async getExisting(userId: string): Promise<SlackGhost|null> {
        if (!this.bridge.getBot().isRemoteUser(userId)) {
            // Catch this early.
            return null;
        }
        const entry = await this.datastore.getUser(userId);
        log.debug("Getting existing ghost for", userId);
        if (!entry) {
            return null;
        }
        const intent = this.bridge.getIntent(userId);
        return SlackGhost.fromEntry(this.datastore, entry, intent);
    }
}
