/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { AdminCommand } from "../../AdminCommand";
import { expect } from "chai";

const LINK_COMMAND = new AdminCommand(
    "link",
    "connect a Matrix and a Slack room together",
    () => { },
    {
        channel_id: {
            alias: "I",
            description: "Slack channel ID",
        },
        room: {
            alias: "R",
            demandOption: true,
            description: "Matrix Room ID",
        },
        slack_bot_token: {
            alias: "t",
            description: "Slack bot user token. Used with Slack bot user & Events api",
        },
        webhook_url: {
            alias: "u",
            description: "Slack webhook URL. Used with Slack outgoing hooks integration",
        },
    },
);

describe("AdminCommand", () => {
    it("constructs", () => {
        new AdminCommand(
            "help [command]",
            "describes the commands available",
            () => {},
        );
    });
    it("calls callback when .handler() is called", async() => {
        // Replace with a spy, once we have a library for that.
        let wasCalledTimes = 0;
        const command = new AdminCommand(
            "help [command]",
            "describes the commands available",
            () => {
                wasCalledTimes++;
            },
        );
        await command.handler({
            matched: () => {},
            completed: () => {},
        } as any);
        expect(wasCalledTimes).to.equal(1);
    });
    it("forwards arguments from handler to the callback", async () => {
        // Replace with a spy, once we have a library for that.
        const response: string[] = [];
        const respondMock = (data: string) => {
            response.push(data);
        };
        const command = new AdminCommand(
            "help [command]",
            "describes the commands available",
            ({ respond }) => {
                respond("hello");
                respond("world");
            },
        );
        await command.handler({
            completed: () => {},
            matched: () => {},
            respond: respondMock,
        } as any);
        expect(response).to.deep.equal(["hello", "world"]);
    });
    describe("returns the simple help as expected", () => {
        it("when there are no options", () => {
            const command = new AdminCommand(
                "help",
                "describes the commands available",
                () => {},
            );
            expect(command.simpleHelp()).to.equal("help - describes the commands available");
        });
        it("when there is a positional option", () => {
            const command = new AdminCommand(
                "help [command]",
                "describes the commands available",
                () => {},
                {
                    command: {
                        demandOption: false,
                        description: "Get help about a particular command",
                    },
                },
            );
            expect(command.simpleHelp()).to.equal("help [command] - describes the commands available");
        });
        it("when there is two types of options", () => {
            const command = new AdminCommand(
                "help [command]",
                "describes the commands available",
                () => {},
                {
                    command: {
                        demandOption: false,
                        description: "Get help about a particular command",
                    },
                    flag: {
                        demandOption: false,
                        description: "Some flag",
                    },
                    other_flag: {
                        demandOption: true,
                        description: "Some other flag",
                    },
                },
            );
            expect(command.simpleHelp()).to.equal("help [command] --other_flag OTHER_FLAG [--flag FLAG] - describes the commands available");
        });
        it("for the complex link command", () => {
            expect(LINK_COMMAND.simpleHelp()).to.equal(
                "link --room ROOM [--channel_id CHANNEL_ID] [--slack_bot_token SLACK_BOT_TOKEN] " +
                "[--webhook_url WEBHOOK_URL] - connect a Matrix and a Slack room together"
            );
        });
    });
    describe("returns the detailed help as expected", () => {
        it("when there are no options", () => {
            const command = new AdminCommand(
                "help [command]",
                "describes the commands available",
                () => { },
            );
            expect(command.detailedHelp()).to.deep.equal([
                "help [command] - describes the commands available"
            ]);
        });
        it("when there is one optional option", () => {
            const command = new AdminCommand(
                "help [command]",
                "describes the commands available",
                () => { },
                {
                    command: {
                        demandOption: false,
                        description: "Get help about a particular command",
                    },
                },
            );
            expect(command.detailedHelp()).to.deep.equal([
                "help [command] - describes the commands available",
                "  command - Get help about a particular command",
            ]);
        });
        it("for the complex link command", () => {
            expect(LINK_COMMAND.detailedHelp()).to.deep.equal([
                "link - connect a Matrix and a Slack room together",
                "  --room|-R - Matrix Room ID (Required)",
                "  --channel_id|-I - Slack channel ID",
                "  --slack_bot_token|-t - Slack bot user token. Used with Slack bot user & Events api",
                "  --webhook_url|-u - Slack webhook URL. Used with Slack outgoing hooks integration",
            ]);
        });
    });
});
