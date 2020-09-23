import { Main } from "../Main";
import { Logging } from "matrix-appservice-bridge";
import { UsersInfoResponse } from "../SlackResponses";

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

    public async handleEvent(ev: {type: string, content: {msgtype: string, body: string}}) {
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
        if (command === "whoami") {
            return this.handleWhoAmI();
        }
        return this.sendNotice(
            "Command not understood",
        );
    }

    public async handleHelp() {
        return this.sendNotice(
            Object.keys(COMMAND_HELP).map((cmd) => `${cmd} - ${COMMAND_HELP[cmd].desc}`).join("\n"),
            "<ul>" + Object.keys(COMMAND_HELP).map((cmd) => `<li><code>${cmd}</code> - ${COMMAND_HELP[cmd].desc}</li>`).join("") + "</ul>",
        );
    }

    public async handleLogin() {
        if (!this.main.oauth2 || !this.main.config.puppeting?.enabled) {
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

    public async handleWhoAmI() {
        const puppets = await this.main.datastore.getPuppetsByMatrixId(this.userId);
        if (puppets.length === 0) {
            return this.sendNotice("You are not logged into Slack. You may talk in public rooms only.");
        }
        let body = "List of connected accounts:\n";
        let formattedBody = "<p>List of connected accounts:</p><ul>";
        for (const puppet of puppets) {
            const cli = await this.main.clientFactory.getClientForUser(puppet.teamId, puppet.matrixId);
            const team = await this.main.datastore.getTeam(puppet.teamId);
            if (cli === null) {
                continue;
            }
            const { user } = await cli.users.info({user: puppet.slackId}) as UsersInfoResponse;
            if (user === undefined) {
                continue;
            }
            body += `You are logged in as ${user.name} (${team!.name})\n`;
            formattedBody += `<li>You are logged in as <strong>${user.name}</strong> (${team!.name}) </li>`;
        }
        formattedBody += "</ul>";
        return this.sendNotice(body, formattedBody);
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
