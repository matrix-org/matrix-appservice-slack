
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

// tslint:disable: no-unused-expression no-any

import { SlackGhostStore } from "../../SlackGhostStore";
import { SlackRoomStore } from "../../SlackRoomStore";
import { FakeDatastore } from "../utils/fakeDatastore";
import { IConfig } from "../../IConfig";
import { expect } from "chai";
import { Bridge, Intent } from "matrix-appservice-bridge";

function getGhostStore() {
    const rooms = new SlackRoomStore();
    const datastore = new FakeDatastore([{
        id: "faketeam",
        bot_id: "",
        bot_token: "",
        name: "Fake Team",
        domain: "fake-team",
        scopes: "",
        status: "ok",
        user_id: "fooo",
    }]);
    const intentHolder: { intent: any } = { intent: null };
    const fakeBridge = {
        getIntent: () => {
            const intent = {
                isRegistered: false,
                _ensureRegistered: () => { intent.isRegistered = true; },
            };
            intentHolder.intent = intent;
            return intent as unknown as Intent;
        },
    } as unknown as Bridge;
    const store = new SlackGhostStore(rooms, datastore, {
        homeserver: {
            server_name: "example.com",
        },
        username_prefix: "_slack_",
    } as IConfig, fakeBridge);
    return {store, datastore, intentHolder};
}

describe("SlackGhostStore", () => {
    it("constructs", () => {
       getGhostStore();
    });
    it("getForSlackMessage should get a ghost with a team_domain and team_id", async () => {
        const {store, datastore, intentHolder} = getGhostStore();
        const user = await store.getForSlackMessage({
            team_domain: "fake-team",
            user_id: "foouser",
        }, "faketeam");
        expect(user.userId).to.equal("@_slack_fake-team_FOOUSER:example.com");
        expect(user.slackId).to.equal("FOOUSER");
        expect(user.teamId).to.equal("FAKETEAM");
        expect(user.displayName).to.be.undefined;
        expect(user.intent).to.equal(intentHolder.intent);
    });
    it("getForSlackMessage should get a ghost with just a team_domain", async () => {
        const {store, datastore, intentHolder} = getGhostStore();
        const user = await store.getForSlackMessage({
            team_domain: "fake-team",
            user_id: "foouser",
        });
        expect(user.userId).to.equal("@_slack_fake-team_FOOUSER:example.com");
        expect(user.slackId).to.equal("FOOUSER");
        expect(user.teamId).to.be.undefined;
        expect(user.displayName).to.be.undefined;
        expect(user.intent).to.equal(intentHolder.intent);
    });
    it("getForSlackMessage should get a ghost with just a team_id", async () => {
        const {store, datastore, intentHolder} = getGhostStore();
        const user = await store.getForSlackMessage({
            user_id: "foouser",
        }, "faketeam");
        expect(user.userId).to.equal("@_slack_fake-team_FOOUSER:example.com");
        expect(user.slackId).to.equal("FOOUSER");
        expect(user.teamId).to.equal("FAKETEAM");
        expect(user.displayName).to.be.undefined;
        expect(user.intent).to.equal(intentHolder.intent);
    });
});
