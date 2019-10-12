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

// tslint:disable: no-unused-expression

import { default as subsitutions } from "../../substitutions";
import { FakeMain } from "../utils/fakeMain";
import { expect } from "chai";
import { Main } from "../../Main";
import { BridgedRoom } from "../../BridgedRoom";

describe("Substitutions", () => {
    const fakeMain = new FakeMain({
        oauth2: false,
        usersInTeam: [
            {
                display_name: "Stranger",
                slack_id: "12345",
                id: "@_slack_12345:localhost",
                avatar_url: "",
            },
            {
                display_name: "Alice",
                slack_id: "12346",
                id: "@_slack_12346:localhost",
                avatar_url: "",
            },
            {
                display_name: "Alice Bob",
                slack_id: "12347",
                id: "@_slack_12347:localhost",
                avatar_url: "",
            },
        ],
    }) as unknown as Main;
    fakeMain.rooms.upsertRoom(new BridgedRoom(fakeMain, {
        matrix_room_id: "!working:localhost",
        slack_channel_id: "workingslackchannel",
        slack_team_id: "footeam",
        inbound_id: "foo",
    }));
    fakeMain.rooms.upsertRoom(new BridgedRoom(fakeMain, {
        matrix_room_id: "!alsoworking:localhost",
        slack_channel_id: "alsoworkingslackchannel",
        slack_team_id: "footeam",
        inbound_id: "foo",
    }));

    describe("matrixToSlack", () => {
        it ("should reject a message with no content", async () => {
            const res = await subsitutions.matrixToSlack({ }, fakeMain, "");
            expect(res).to.be.null;
        });
        it ("should reject a message with invalid content", async () => {
            let res;
            res = await subsitutions.matrixToSlack({ content: { } }, fakeMain, "");
            expect(res).to.be.null;
            res = await subsitutions.matrixToSlack({ content: { body: "" } }, fakeMain, "");
            expect(res).to.be.null;
            res = await subsitutions.matrixToSlack({ content: { body: 0 } }, fakeMain, "");
            expect(res).to.be.null;
            res = await subsitutions.matrixToSlack({ content: { body: true } }, fakeMain, "");
            expect(res).to.be.null;
            res = await subsitutions.matrixToSlack({ content: { body: { foo: "bar"} } }, fakeMain, "");
            expect(res).to.be.null;
            // No sender
            res = await subsitutions.matrixToSlack({ content: { body: "bar" } }, fakeMain, "");
            expect(res).to.be.null;
        });
        it ("should allow a simple text message with no msgtype", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello world!",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello world!",
                username: "@alice:localhost",
            });
        });
        it ("should allow a simple m.text message", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello world!",
                    msgtype: "m.text",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello world!",
                username: "@alice:localhost",
            });
        });
        it ("should allow a simple message with any other type", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello world!",
                    msgtype: "org.matrix.fake.message.type",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello world!",
                username: "@alice:localhost",
            });
        });
        it ("should handle m.emote", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "This is not sarcasm",
                    msgtype: "m.emote",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "_This is not sarcasm_",
                username: "@alice:localhost",
            });
        });
        it ("should replace <, > and & with HTML codes", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Let's talk about <html> and the & character",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Let's talk about &lt;html&gt; and the &amp; character",
                username: "@alice:localhost",
            });
        });
        it ("should replace @room with @channel", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "@room Hello everyone!",
                },
                sender: "@alice:localhost",
            }, fakeMain, "");
            expect(res).to.deep.equal({
                link_names: true,
                text: "@channel Hello everyone!",
                username: "@alice:localhost",
            });
        });
        it ("should replace room pills with slack mentions", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "You should join my room #working:localhost",
                    format: "org.matrix.custom.html",
                    formatted_body: "You should join my room <a href=\"https://matrix.to/#/#working:localhost\">#working:localhost</a>.",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "You should join my room <#workingslackchannel>",
                username: "@alice:localhost",
            });
        });
        it ("should replace multiple room pills with slack mentions", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "You should join my room #working:localhost, or perhaps #working2:localhost",
                    format: "org.matrix.custom.html",
                    formatted_body: "You should join my room <a href=\"https://matrix.to/#/#working:localhost\">#working:localhost</a>, " +
                    "or perhaps <a href=\"https://matrix.to/#/#working2:localhost\">#working2:localhost</a>",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "You should join my room <#workingslackchannel>, or perhaps <#alsoworkingslackchannel>",
                username: "@alice:localhost",
            });
        });
        it ("should replace user pills with slack mentions", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello! Stranger",
                    format: "org.matrix.custom.html",
                    formatted_body: "Hello! <a href=\"https://matrix.to/#/@stranger:localhost\">Stranger</a>.",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello! <@12345>",
                username: "@alice:localhost",
            });
        });
        it ("should replace multiple user pills with slack mentions", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello! Stranger Thing",
                    format: "org.matrix.custom.html",
                    formatted_body: "Hello! <a href=\"https://matrix.to/#/@stranger:localhost\">Stranger</a> " +
                    "<a href=\"https://matrix.to/#/@thing:localhost\">Thing</a>",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello! <@12345> <@54321>",
                username: "@alice:localhost",
            });
        });
        it ("should replace non-pilled @user mentions", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello! @Stranger",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello! <@12345>",
                username: "@alice:localhost",
            });
        });
        it ("should replace non-pilled @user mentions with the most obvious match", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "Hello! @Alice Bob",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "Hello! <@12347>",
                username: "@alice:localhost",
            });
        });
        it ("should replace matrix links with slack links", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "This bridge is built on the [Matrix](https://matrix.org) protocol.",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "This bridge is built on the <https://matrix.org|Matrix> protocol.",
                username: "@alice:localhost",
            });
        });
        it ("should replace multiple matrix links with slack links", async () => {
            const res = await subsitutions.matrixToSlack({
                content: {
                    body: "[a](http://example.com) b [c](http://example.net)",
                },
                sender: "@alice:localhost",
            }, fakeMain, "footeam");
            expect(res).to.deep.equal({
                link_names: true,
                text: "<http://example.com|a> b <http://example.net|c>",
                username: "@alice:localhost",
            });
        });
    });
});
