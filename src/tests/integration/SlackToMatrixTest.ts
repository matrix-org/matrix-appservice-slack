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
import { SlackHookHandler } from "../../SlackHookHandler";
import { FakeMain } from "../utils/fakeMain";
import { Main } from "../../Main";
import { expect } from "chai";
import { SlackEventHandler } from "../../SlackEventHandler";
import { ISlackMessageEvent } from "../../BaseSlackHandler";
import { BridgedRoom } from "../../BridgedRoom";

const constructHarness = () => {
    const main = new FakeMain({
        oauth2: false,
        teams: [
            {
                bot_token: "foo",
                id: "12345",
                name: "FakeTeam",
                domain: "fake-domain",
                user_id: "foo",
                bot_id: "bar",
                status: "ok",
                scopes: "",
            },
        ],
    });
    const hooks = new SlackHookHandler(main as unknown as Main);
    return { eventHandler: hooks.eventHandler, main };
};

describe("SlackToMatrix", () => {
    let harness: { eventHandler: SlackEventHandler, main: FakeMain };

    beforeEach(() => {
        harness = constructHarness();
    });

    it("will drop Slack events that have an unknown type", async () => {
        let called = false;
        await harness.eventHandler.handle({
            user_id: "foo",
            type: "faketype",
            channel: "fakechannel",
            ts: "12345",
        }, "12345", (status: number, body?: string) => {
            called = true;
            expect(status).to.equal(200);
            expect(body).to.equal("OK");
        }, false);
        expect(harness.main.timerFinished.remote_request_seconds).to.be.equal("dropped");
        expect(called).to.be.true;
    });

    it("will not handle replies with tombstoned contents", async () => {
        harness.main.rooms.upsertRoom({
            InboundId: "foobarId",
            MatrixRoomId: "!foo:bar",
            SlackChannelId: "fakechannel",
            SlackClient: true, // To ensure we do not drop out early
        } as unknown as BridgedRoom);
        let called = false;
        await harness.eventHandler.handle({
            user_id: "foo",
            type: "message",
            subtype: "message_changed",
            hidden: true,
            message: {
                user_id: "foo",
                channel: "foo",
                type: "message",
                subtype: "tombstone",
                ts: "1569567229.124700",
            },
            channel: "fakechannel",
            ts: "12345",
        } as ISlackMessageEvent,
        "12345", (status: number, body?: string) => {
            called = true;
            expect(status).to.equal(200);
            expect(body).to.equal("OK");
        }, false);
        expect(harness.main.timerFinished.remote_request_seconds).to.be.equal("dropped");
        expect(called).to.be.true;
    });

    it("will no-op Slack events when using RTM API and is an Event API request", async () => {
        let called = false;
        await harness.eventHandler.handle({
            user_id: "foo",
            type: "faketype",
            channel: "fakechannel",
            ts: "12345",
        }, "12345", (status: number, body?: string) => {
            called = true;
            expect(status).to.equal(200);
            expect(body).to.equal("OK");
        }, true);
        expect(harness.main.timerFinished.remote_request_seconds).to.be.undefined;
        expect(called).to.be.true;
    });
});
