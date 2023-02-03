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
import { Main } from "../../src/Main";
import { expect } from "chai";
import axios from "axios";

import { constructHarness } from "../utils/harness";

let harness: { main: Main };

describe("HttpTests", () => {

    beforeEach(() => {
        harness = constructHarness();
    });

    it("will respond 200 to a health check", async () => {
        await harness.main.run(57000);
        const res = await axios.get("http://127.0.0.1:57000/health");
        expect(res.status).to.equal(200);
        expect(res.data).to.equal("OK");
    });

    afterEach(async () => {
        await harness.main.killBridge();
    });
});
