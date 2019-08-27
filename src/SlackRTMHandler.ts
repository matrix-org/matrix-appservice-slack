/**
 * This class handles events coming in from slack.
 */

import { RTMClient, LogLevel } from "@slack/rtm-api";
import { Main, ISlackTeam } from "./Main";
import { SlackEventHandler } from "./SlackEventHandler";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("SlackRTMHandler");

const LOG_TEAM_LEN = 12;

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
        const connLog = Logging.get(`RTM-${expectedTeam.substr(0, LOG_TEAM_LEN)}`);
        const rtm = new RTMClient(botToken, {
            logLevel: LogLevel.DEBUG, // We will filter this ourselves.
            logger: {
                setLevel: () => {},
                setName: () => {}, // We handle both of these ourselves.
                ...connLog,
            },
        });

        rtm.on("error", (error) => {
            // We must handle this lest the process be killed.
            connLog.error("Encountered 'error' event:", error);
        });

        // For each event that SlackEventHandler supports, register
        // a listener. 
        SlackEventHandler.SUPPORTED_EVENTS.forEach((eventName) => {
            rtm.on(eventName, async (event) => {
                try {
                    if (!rtm.activeTeamId) {
                        log.error("Cannot handle event, no active teamId!");
                        return;
                    }
                    await this.handle(event, rtm.activeTeamId! , () => {});
                } catch (ex) {
                    log.error(`Failed to handle '${eventName}' event`);
                }
            });
        });

        try {
            const { _self, team } = await rtm.start();
            const teamInfo = team as ISlackTeam;
            this.rtmClients.set(teamInfo.id , rtm);
            log.info("Connected RTM client for ", teamInfo);
        } catch (ex) {
            log.error("Failed to connect RTM client for ", expectedTeam);
        }
    }
}