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
import { Main } from "../../Main";
import { expect } from "chai";
import * as request from "request-promise-native";
import { Response } from "request";

import { constructHarness } from "../utils/harness";
import { FakeDatastore } from "../utils/fakeDatastore";

// tslint:disable: no-unused-expression no-any

let harness: { main: Main };

describe("AdminCommandTest", () => {

    beforeEach(async () => {
        harness = constructHarness();
        await harness.main.run(57000);
        harness.main.datastore = new FakeDatastore();
    });

    it("will not respond to itself", async () => {
        await harness.main.onMatrixEvent({
            event_id: "foo",
            room_id: "!admin_room:foobar",
            sender: harness.main.botUserId,
            content: {
                body: "help",
            },
            type: "m.room.message",
        });
    });

    afterEach(async () => {
        console.log("Killing bridge");
        await harness.main.killBridge();
        console.log("Killing bridge");
    });
});