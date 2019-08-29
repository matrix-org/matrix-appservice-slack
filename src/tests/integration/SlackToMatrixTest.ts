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

// tslint:disable: no-unused-expression no-any

function constructHarness() {
    const main = new FakeMain();
    const hooks = new SlackHookHandler(main as unknown as Main);
    return { eventHandler: hooks.eventHandler, main };
}

let harness: { eventHandler: SlackEventHandler, main: FakeMain };

describe("SlackToMatrix", () => {

    beforeEach(() => {
        harness = constructHarness();
    });

    it("will drop slack events that have an unknown type", async () => {
        await harness.eventHandler.handle({
            type: "faketype",
            channel: "fakechannel",
            ts: "12345",
        }, "12345", (status: number, body?: string) => {
            expect(status).to.equal(200);
            expect(body).to.equal("OK");
        });
        expect(harness.main.timerFinished.remote_request_seconds).to.be.equal("dropped");
    });
});
