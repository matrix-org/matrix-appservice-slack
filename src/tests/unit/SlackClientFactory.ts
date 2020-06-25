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

import { SlackClientFactory } from "../../SlackClientFactory";
import { FakeDatastore } from "../utils/fakeDatastore";
import { SlackTestApi } from "../utils/slackTestApi";
import { expect } from "chai";
import { TeamEntry } from "../../datastore/Models";

const testApi = new SlackTestApi();

function createFactory() {
    const fakeDatastore = new FakeDatastore();
    const calls: string[] = [];
    const updatePuppetCountCalls: {teamId : string, delta: number}[] = [];
    const factory = new SlackClientFactory(fakeDatastore, {
        slack_client_opts: testApi.opts,
        auth_interval_ms: 1,
        }
    , (method: string) => {
        calls.push(method);
    }, (teamId: string, delta: number) => {
        updatePuppetCountCalls.push({teamId, delta});
    });
    return {
        factory: factory as SlackClientFactory,
        calls,
        updatePuppetCountCalls,
        ds: fakeDatastore
    };
}

describe("SlackClientFactory", () => {
    before(async () => {
        await testApi.start();
    });

    it("should construct", async () => {
        const { factory, calls } = createFactory();
        expect(calls).to.be.empty;
        expect(await factory.getClientForUser("faketeam", "fakeuser")).to.be.null;
        expect(async () => { await factory.getTeamClient("faketeam"); }).to.throw;
    });

    it("should not create a team client for a non-existant team", async () => {
        const { factory, calls } = createFactory();
        expect(calls).to.be.empty;
        try {
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("No team found in store for faketeam");
        }
    });

    it("should not create a team client for a team that has a status of bad_auth", async () => {
        const { factory, calls, ds } = createFactory();
        ds.teams.push({
            id: "faketeam",
            status: "bad_auth",
        } as TeamEntry);
        expect(calls).to.be.empty;
        try {
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("Team faketeam is not usable: Team previously failed to auth and is disabled");
        }
    });

    it("should not create a team client for a team that has a status of archived", async () => {
        const { factory, calls, ds } = createFactory();
        ds.teams.push({
            id: "faketeam",
            status: "archived",
        } as TeamEntry);
        expect(calls).to.be.empty;
        try {
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("Team faketeam is not usable: Team is archived");
        }
    });

    it("should not create a team client for a team that has no token", async () => {
        const { factory, calls, ds } = createFactory();
        ds.teams.push({
            id: "faketeam",
            status: "ok",
        } as TeamEntry);
        expect(calls).to.be.empty;
        try {
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("Team faketeam is not usable: No token stored");
        }
    });

    it("should not create a team client that fails to pass auth", async () => {
        const { factory, calls, ds } = createFactory();
        ds.teams.push({
            id: "faketeam",
            status: "ok",
            bot_token: "acceptable_token",
        } as TeamEntry);
        expect(calls).to.be.empty;
        try {
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("Could not create team client");
            expect(ds.teams[0].status).to.equal("bad_auth");
        }
    });

    it("should create a team client, and then reauthenticate after some time", async () => {
        const { factory, calls, ds } = createFactory();
        ds.teams.push({
            id: "faketeam",
            status: "ok",
            bot_token: "one_time_token",
        } as TeamEntry);
        expect(calls).to.be.empty;
        testApi.allowAuthFor.add("one_time_token");
        await factory.getTeamClient("faketeam");
        testApi.allowAuthFor.delete("one_time_token");
        try {
            await new Promise((res) => setTimeout(res, 2));
            await factory.getTeamClient("faketeam");
            throw Error("Call didn't throw as expected");
        } catch (ex) {
            expect(ex.message).to.equal("Could not create team client");
            expect(ds.teams[0].status).to.equal("bad_auth");
        }
    });

    after(async () => {
        await testApi.close();
    });
});
