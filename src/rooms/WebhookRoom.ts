import { BridgedRoom, ISlackChatMessagePayload, MatrixMessageEvent, stripMatrixReplyFallback } from "../BridgedRoom";
import { Main, METRIC_SENT_MESSAGES } from "../Main";
import { Logging } from "matrix-appservice-bridge";
import substitutions from "../substitutions";
import axios from "axios";

const log = Logging.get("WebhookRoom");

export class WebhookRoom extends BridgedRoom {

    // Webhook rooms are always public
    public get IsPrivate(): boolean { return false; }

    public set SlackWebhookUri(value: string) {
        this.dirty = this.dirty || (this.slackWebhookUri !== value);
        this.slackWebhookUri = value;
    }

    public get SlackWebhookUri(): string {
        return this.slackWebhookUri;
    }

    public getStatus(): string {
        if (!this.slackWebhookUri) {
            return "pending-params";
        }
        return "ready";
    }

    constructor(main: Main, matrixRoomId: string, inboundId: string, private slackWebhookUri: string) {
        super(main, matrixRoomId, inboundId);
    }

    public async onMatrixMessage(message: MatrixMessageEvent): Promise<boolean> {
        const user = this.main.getOrCreateMatrixUser(message.sender);
        message = stripMatrixReplyFallback(message);
        const matrixToSlackResult = await substitutions.matrixToSlack(message, this.main);
        if (!matrixToSlackResult) {
            // Could not handle content, dropped.
            log.warn(`Dropped ${message.event_id}, message content could not be identified`);
            return false;
        }
        const body: ISlackChatMessagePayload = {
            ...matrixToSlackResult,
            as_user: false,
            username: user.getDisplaynameForRoom(message.room_id) || matrixToSlackResult.username,
        };
        const text = body.text;
        if (!body.attachments && !text) {
            // The message type might not be understood. In any case, we can't send something without
            // text.
            log.warn(`Dropped ${message.event_id}, message had no attachments or text`);
            return false;
        }
        const reply = await this.findParentReply(message);
        let parentStoredEvent: EventEntry | null = null;
        if (reply !== message.event_id) {
            parentStoredEvent = await this.main.datastore.getEventByMatrixId(message.room_id, reply);
            // We have a reply
            if (parentStoredEvent) {
                body.thread_ts = parentStoredEvent.slackTs;
            }
        }

        const avatarUrl = user.getAvatarUrlForRoom(message.room_id);

        if (avatarUrl && avatarUrl.indexOf("mxc://") === 0) {
            body.icon_url = this.main.getUrlForMxc(avatarUrl);
        }

        user.bumpATime();
        this.matrixATime = Date.now() / 1000;
        const webhookRes = await axios.post(this.slackWebhookUri, body);
        if (webhookRes.status !== 200) {
            log.error("Failed to send webhook message");
            return false;
        }
        // Webhooks don't give us any ID, so we can't store this.
        this.main.incCounter(METRIC_SENT_MESSAGES, {side: "remote"});
        // Log activity, but don't await the answer or throw errors
        this.main.datastore.upsertActivityMetrics(user, this).catch((err) => {
            log.error(`Error storing activity metrics`, err);
        });
        return true;
    }
}