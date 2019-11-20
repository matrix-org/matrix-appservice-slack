import { BridgedRoom, IBridgedRoomOpts } from "../BridgedRoom";
import { Main } from "../Main";
import { TeamEntry } from "../datastore/Models";
import { WebClient } from "@slack/web-api";
import { ISlackMessageEvent } from "../BaseSlackHandler";
import { ConversationsMembersResponse } from "../SlackResponses";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("DMRoom");

/**
 * The DM room class is used to implement custom logic for
 * "im" and "mpim" rooms.
 */
export class DMRoom extends BridgedRoom {
    constructor(main: Main, opts: IBridgedRoomOpts, team: TeamEntry, botClient: WebClient) {
        super(main, opts, team, botClient);
    }

    public async onSlackMessage(message: ISlackMessageEvent, content?: Buffer) {
        await super.onSlackMessage(message, content);

        // Check if the recipient is joined to the room.
        const cli = await this.main.clientFactory.getClientForUser(this.SlackTeamId!, this.puppetOwner!);
        if (!cli) {
            return;
        }

        const expectedSlackMembers = (await cli.conversations.members({ channel: this.SlackChannelId! }) as ConversationsMembersResponse).members;
        const expectedMatrixMembers = (await Promise.all(expectedSlackMembers.map(
            (slackId) => this.main.datastore.getPuppetMatrixUserBySlackId(this.SlackTeamId!, slackId),
        )));

        const members = await this.main.listAllUsers(this.MatrixRoomId);
        const intent = await this.getIntentForRoom();

        try {
            await Promise.all(
                expectedMatrixMembers.filter((s) => s !== null && !members.includes(s)).map(
                    (member) => {
                        log.info(`Reinviting ${member} to the room`);
                        return intent.invite(this.MatrixRoomId, member);
                    },
                ),
            );
        } catch (ex) {
            log.warn("Failed to reinvite user to the room:", ex);
        }
    }

    public static createMatrixRoom() {
        
    }
}
