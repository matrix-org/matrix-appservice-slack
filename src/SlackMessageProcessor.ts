import { Logging } from "matrix-appservice-bridge";
import substitutions from "./substitutions";

const log = new Logging("SlackMessageProcessor");

/**
 * This class processes slack messages and returns instructions
 * for sending to matrix.
 */
export class SlackMessageProcessor {
    constructor() {

    }

    public async process(msg: IMessage): Promise<IProccessedSlackMessage|null> {
        let processed: IProccessedSlackMessage;
        msg = this.preprocessMessage(msg);
        if (!msg.subtype) {
            processed = this.onMessage();
        } else {
            // Type not known.
            log.info(`Unknown type ${msg.subtype}, ignoring for ${msg.ts}`);
            return null;
        }
        return processed;
    }

    private preprocessMessage(msg: IMessage): IMessage {
        return msg;
    }

    private async onMessage(msg: IMessage): Promise<IProccessedSlackMessage> {
        let text = msg.text;
        text = substitutions.slackToMatrix(text);
    }
}

interface IMessage {
    type: "message";
    channel: string;
    user?: string;
    text: string;
    ts: string;
    subtype?: string;
    edited?: {
        user: string;
        ts: string;
    },
    message?: IMessage,
    hidden?: true;
}

export interface IProccessedSlackMessage {

}