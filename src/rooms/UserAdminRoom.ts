import { Main } from "../Main";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("UserAdminRoom");

const COMMAND_HELP = {
    help: { desc: "Shows you this help text" },
    login: { desc: "Log into a Slack account" },
};

export class UserAdminRoom {
    public static IsAdminRoomInvite(event: any, botId: string) {
        return (event.content.membership === "invite" &&
                event.state_key === botId &&
                event.content.is_direct === true);
    }

    constructor(private roomId: string, private userId: string, private main: Main) {

    }

    public async handleEvent(ev: any) {
        if (ev.type !== "m.room.message" || ev.content.msgtype !== "m.text" || !ev.content.body) {
            return;
        }
        const args: string[] = ev.content.body.split(" ");
        const command = args[0].toLowerCase();
        log.info(`${this.userId} sent admin message ${args[0].substr(32)}`);
        if (command === "help") {
            return this.handleHelp();
        }
        if (command === "login") {
            return this.handleLogin();
        }
        return this.sendNotice(
            "Command not understood",
        );
    }

    public async handleHelp() {
        return this.sendNotice(
            Object.keys(COMMAND_HELP).map((cmd) => `${cmd} - ${COMMAND_HELP[cmd].desc}`).join("\n"),
            // tslint:disable-next-line: prefer-template
            "<ul>" + Object.keys(COMMAND_HELP).map((cmd) => `<li><code>${cmd}</code> - ${COMMAND_HELP[cmd].desc}</li>`).join("") + "</ul>",
        );
    }

    public async handleLogin() {
        if (!this.main.oauth2 || !this.main.config.rtm) {
            await this.sendNotice("This bridge is not configured to allow logging into Slack accounts.");
            return;
        }
        const token = this.main.oauth2.getPreauthToken(this.userId);
        const authUri = this.main.oauth2.makeAuthorizeURL(
            token,
            token,
            true,
        );
        await this.sendNotice(
            `Follow ${authUri} to connect your account.`,
            `Follow <a href="${authUri}">this link</a> to connect your account.`,
        );
    }

    private async sendNotice(body: string, formattedBody?: string) {
        return this.main.botIntent.sendMessage(this.roomId, {
            msgtype: "m.notice",
            body,
            formatted_body: formattedBody,
            format: formattedBody ? "org.matrix.custom.html" : undefined,
        });
    }
}
