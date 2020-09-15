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

import { MatrixUser } from "../../MatrixUser";
import { Main } from "../../Main";
import { expect } from "chai";
import { SlackRTMHandler } from "../../SlackRTMHandler";
import { FakeMain } from "../utils/fakeMain";
import { EventEmitter } from "events";

const createHandler = () => {
    const fakeMain = new FakeMain();
    const handler: any = new SlackRTMHandler(fakeMain as unknown as Main);
    handler.createRtmClient = () => {
        const rtm: any = new EventEmitter();
        rtm.start = () => ({});
        handler._rtmClient = rtm;
        return rtm;
    };
    return { handler };
}

describe("SlackRTMHandler", () => {
    // https://github.com/matrix-org/matrix-appservice-slack/issues/212
    it("should not race messages from RTM clients", async () => {
        const { handler } = createHandler();
        await handler.startUserClient({
            matrixId: "@foo:bar",
            slackId: "ABC123UF",
            teamId: "TE4M",
            token: "foobartoken",
        });
        const client = handler._rtmClient;
        const messages = ["Test 1", "Test 2", "Test 3", "Test 4", "Test 5"];
        let wasCalled = 0;
        const allDone = new Promise((resolve, reject) => {
            handler.handleRtmMessage = async (a, b, c, e) => {
                wasCalled++;
                if (wasCalled === 5) {
                    resolve();
                }
                expect(e.text).to.equal(messages.shift());
                return new Promise((to) => setTimeout(to, 50));
            };
        });

        client.emit("message", {channel: "fooo", text: "Test 1"});
        client.emit("message", {channel: "fooo", text: "Test 2"});
        client.emit("message", {channel: "fooo", text: "Test 3"});
        client.emit("message", {channel: "fooo", text: "Test 4"});
        client.emit("message", {channel: "fooo", text: "Test 5"});
        await allDone;
    });
});
