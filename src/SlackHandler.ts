/**
 * This class handles events coming in from slack.
 */

import { RTMClient } from "@slack/rtm-api";
import { Main, ISlackTeam } from "./Main";
import { SlackEventHandler } from "./SlackEventHandler";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("SlackRTMHandler");

export class SlackRTMHandler extends SlackEventHandler {
    private rtmClients: Map<string, RTMClient>; // team -> client
    constructor(main: Main) {
        super(main);
        this.rtmClients = new Map();
    }

    public async startTeamClientIfNotStarted(expectedTeam: string, botToken: string) {
        if (this.rtmClients.has(expectedTeam)) {
            log.debug(`${expectedTeam} is already connected`);
            return;
        }
        const rtm = new RTMClient(botToken);
        rtm.on("message", async (event) => {
            log.debug("Got event", event);
            try {
                await this.handleMessageEvent({
                    event,
                    name: "noname",
                    team_id: rtm.activeTeamId!,
                    type: "message",
                });
            } catch (ex) {
                log.error("Failed to handle event");
            }
        });
        try {
            const { self, team } = await rtm.start();
            const teamInfo = team as ISlackTeam;
            this.rtmClients.set(teamInfo.id , rtm);
            log.info("Connected RTM client for ", teamInfo);
        } catch (ex) {
            log.error("Failed to connect RTM client for ", expectedTeam);
        }
    }
}