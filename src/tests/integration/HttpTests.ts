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

import { AppServiceRegistration } from "matrix-appservice";

// tslint:disable: no-unused-expression no-any

function constructHarness() {
    const reg = new AppServiceRegistration("foobar");
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("test_bot");
    reg.setId("foobar");
    const main = new Main({
        bot_username: "test_bot",
        matrix_admin_room: "foobar",
        username_prefix: "test_",
        homeserver: {
            url: "foobar",
            server_name: "foobar",
        },
        enable_metrics: false,
        dbdir: "/tmp",
        logging: {
            console: "info",
        },
        rtm: {
            enable: true,
        },
    }, reg);
    return { main };
}

let harness: { main: Main };

describe("HttpTests", () => {

    beforeEach(() => {
        harness = constructHarness();
    });

    it("will respond 201 to a health check", async () => {
        await harness.main.run(57000);
        const res = await request.get("http://localhost:57000/health", {
            resolveWithFullResponse: true,
        }) as Response;
        expect(res.statusCode).to.equal(201);
        expect(res.body).to.be.empty;
    });

    // TODO: Currently, this will hang after completing as we cannot tell the bridge
    // to stop! Running --exit on the mocha process works good enough for now.

});
