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
import * as request from "request-promise-native";
import { Response } from "request";

// tslint:disable: no-unused-expression no-any

function constructHarness() {
    const main = new FakeMain();
    const hooks = new SlackHookHandler(main as unknown as Main);
    return { hooks, main };
}

let harness: { hooks: SlackHookHandler, main: FakeMain };

describe("HttpTests", () => {

    beforeEach(() => {
        harness = constructHarness();
    });

    it("will respond 201 to a health check", async () => {
        await harness.hooks.startAndListen(57000);
        const res = await request.get("http://localhost:57000/health", {
            resolveWithFullResponse: true,
        }) as Response;
        expect(res.statusCode).to.equal(201);
        expect(res.body).to.be.empty;
    });

    afterEach(async () => {
        await harness.hooks.close();
    });
});
