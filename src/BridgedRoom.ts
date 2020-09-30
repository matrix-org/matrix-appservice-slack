/* eslint-disable @typescript-eslint/no-unused-vars */
import { WeakEvent } from "matrix-appservice-bridge";
import { ISlackMessageEvent } from "./BaseSlackHandler";
import { RoomEntry } from "./datastore/Models";
import { Main } from "./Main";
import { IMatrixToSlackResult } from "./substitutions";

export type SlackChannelTypes = "mpim"|"im"|"channel"|"group"|"unknown";

export interface MatrixReactionEvent extends WeakEvent {
    content: {
        "m.relates_to": {
            "event_id": string;
            key: string;
        };
    };
}

export interface MatrixRedactionEvent extends WeakEvent {
    content: {
        reason: string;
    }
    redacts: string;
}

export interface MatrixEditEvent extends WeakEvent {
    content: {
        body: string;
        "m.new_content": {
            body: string;
            msgtype: string;
        };
        "m.relates_to": {
            event_id: string;
            rel_type: "m.replace";
        };
    }
    redacts: string;
}
export interface MatrixMessageEvent extends WeakEvent {
    content: {
        body: string;
        msgtype: string;
        formatted_body: string;
        format: string;
    }
    redacts: string;
}

export interface ISlackChatMessagePayload extends IMatrixToSlackResult {
    as_user?: boolean;
    channel?: string;
    thread_ts?: string;
    icon_url?: string;
}


export abstract class BridgedRoom {

    public get IsPrivate(): boolean {
        return false;
    }

    /**
     * True if this instance has changed from the version last read/written to the RoomStore.
     */
    protected dirty = false;

    public get isDirty(): boolean {
        return this.dirty;
    }

    /**
     * Last activity for Slack timestamp in seconds
     */
    public get RemoteATime(): number {
        return this.slackATime;
    }

    /**
     * Last activity for Matrix timestamp in seconds
     */
    public get MatrixATime(): number {
        return this.matrixATime;
    }


    // last activity time in epoch seconds
    protected slackATime = 0;
    protected matrixATime = 0;

    /**
     * Is the room in use. (TODO: what does this mean?)
     */
    public MatrixRoomActive = true;

    public get MatrixRoomId(): string {
        return this.matrixRoomId;
    }

    public get InboundId(): string {
        return this.inboundId;
    }

    public set InboundId(value: string) {
        this.dirty = this.dirty || (this.inboundId !== value);
        this.inboundId = value;
    }

    constructor(protected readonly main: Main, protected matrixRoomId: string, protected inboundId: string) {
        if (!matrixRoomId) {
            throw Error("BridgedRoom requires an Matrix Room ID");
        }
        if (!inboundId) {
            throw Error("BridgedRoom requires an inboundId");
        }
    }

    public migrateToNewRoomId(newRoomId: string): void {
        this.matrixRoomId = newRoomId;
    }

    /**
     * These should be overwridden by the room classes.
     */

    public getStatus(): string {
        throw Error('Not implemented');
    }

    public async onMatrixMessage(message: MatrixMessageEvent): Promise<boolean> {
        throw Error('Not implemented');
    }

    public async onMatrixEdit(message: MatrixEditEvent): Promise<boolean> {
        throw Error('Not implemented');
    }

    public async onMatrixReaction(ev: MatrixReactionEvent): Promise<void> {
        throw Error('Not implemented');
    }

    public async onMatrixRedaction(message: MatrixRedactionEvent): Promise<void> {
        throw Error('Not implemented');
    }

    public async onMatrixJoin(userId: string): Promise<void> {
        throw Error('Not implemented');
    }

    public async onMatrixLeave(userId: string): Promise<void> {
        throw Error('Not implemented');
    }

    public async onMatrixInvite(sender: string, userId: string): Promise<void> {
        throw Error('Not implemented');
    }


    public async onSlackMessage(message: ISlackMessageEvent): Promise<void> {

    }

    /**
     * Force given set of ghosts to leave the room
     * @param ghosts MxIDs of ghost users
     */
    public async leaveGhosts(ghosts: string[]): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const ghost of ghosts) {
            promises.push(this.main.getIntent(ghost).leave(this.matrixRoomId));
        }
        await Promise.all(promises);
    }

    public toEntry(): RoomEntry {
        throw Error('Not implemented');
    }
}

/*
    Strip out reply fallbacks. Borrowed from
    https://github.com/turt2live/matrix-js-bot-sdk/blob/master/src/preprocessors/RichRepliesPreprocessor.ts
*/
export const stripMatrixReplyFallback = (event: MatrixMessageEvent): MatrixMessageEvent => {
    let realHtml = event.content.formatted_body;
    let realText = event.content.body;

    if (event.content.format === "org.matrix.custom.html" && event.content.formatted_body) {
        const formattedBody = event.content.formatted_body;
        if (formattedBody.startsWith("<mx-reply>") && formattedBody.indexOf("</mx-reply>") !== -1) {
            const parts = formattedBody.split("</mx-reply>");
            realHtml = parts[1];
            event.content.formatted_body = realHtml.trim();
        }
    }

    let processedFallback = false;
    const body = event.content.body || "";
    for (const line of body.split("\n")) {
        if (line.startsWith("> ") && !processedFallback) {
            continue;
        } else if (!processedFallback) {
            realText = line;
            processedFallback = true;
        } else {
            realText += line + "\n";
        }
    }

    event.content.body = realText.trim();
    return event;
};

