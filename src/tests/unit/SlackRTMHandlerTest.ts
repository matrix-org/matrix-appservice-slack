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

function createHandler() {
    const fakeMain = new FakeMain();
    return new SlackRTMHandler(fakeMain as unknown as Main);
}

describe("SlackRTMHandler", () => {
    // https://github.com/matrix-org/matrix-appservice-slack/issues/212
    it("should not race messages from RTM clients", () => {
        const handler = createHandler();
        handler.startUserClient()
    });
});
