import { App, KnownEventFromType, ReactionAddedEvent, ReactionRemovedEvent, SlackEvent } from "@slack/bolt";
import { Main, METRIC_RECEIVED_MESSAGE } from "./Main";
import { SlackEventHandler } from "./SlackEventHandler";
import { Logger } from "matrix-appservice-bridge";
import { ISlackEvent } from "./BaseSlackHandler";

const log = new Logger("SlackAppHandler");

interface Config {
    appToken: string,
    signingSecret: string,
    botToken: string,
}

export class SlackAppHandler extends SlackEventHandler {
    private constructor(
        main: Main,
        private app: App,
        private teamId: string
    ) {
        super(main);
        this.app.message(async ({ message }) => this.handleSlackAppEvent(message));
        this.app.event(new RegExp('^reaction'), ({ event }) => this.handleSlackAppEvent(event));
    }

    public static async create(main: Main, config: Config) {
        const app = new App({
            appToken: config.appToken,
            token: config.botToken,
            signingSecret: config.signingSecret,
            socketMode: true,
        });
        await app.start();
        const teamId = await main.clientFactory.upsertTeamByToken(config.botToken);
        log.info(`Slack App listening for events for team ${teamId}`);
        return new SlackAppHandler(main, app, teamId);
    }

    private async handleSlackAppEvent(ev: SlackEvent) {
        try {
            switch (ev.type) {
                case 'message': return this.onMessage(ev);
                case 'reaction_added':
                case 'reaction_removed':
                    return this.onReaction(ev);
                default:
                    log.warn(`Ignoring event of type ${ev.type}`);
            }
        } catch (err) {
            log.error(`Failed to handle Slack App event ${JSON.stringify(ev, undefined, 2)}: ${err}`);
        }
    }

    private async onMessage(msg: KnownEventFromType<'message'>) {
        log.debug("Received a message:", msg);

        this.main.incCounter(METRIC_RECEIVED_MESSAGE, { side: "remote" });

        switch (msg.subtype) {
            case undefined: // regular message
            case "file_share":
                return this.handleEvent({
                    ...msg,
                    user_id: msg.user,
                }, this.teamId);
            case "message_changed":
                return this.handleMessageEvent({
                    ...msg as any,
                    user_id: '', // SlackEventHandler requires, but ignores this...
                    user: (msg.previous_message as any).user, // ...and actually uses this
                }, this.teamId);
            case "message_deleted":
                return this.handleMessageEvent({
                    ...msg as any,
                    user_id: '', // SlackEventHandler requires, but ignores this...
                    user: (msg.previous_message as any).user, // ...and actually uses this
                }, this.teamId);
            default:
                log.warn(`Unhandled message subtype ${msg.subtype}`);
        }
    }

    async onReaction(ev: ReactionAddedEvent|ReactionRemovedEvent): Promise<void> {
        return this.handleEvent(ev as unknown as ISlackEvent, this.teamId);
    }
}
