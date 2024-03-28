/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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
import { SlackHookHandler } from "../../src/SlackHookHandler";
import { FakeMain } from "../utils/fakeMain";
import { Main } from "../../src/Main";
import { expect } from "chai";
import * as httpMocks from "node-mocks-http";
import * as randomstring from "randomstring";
import { BridgedRoom } from "../../src/BridgedRoom";

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
    return { hooks, main };
};

const DEFAULT_PAYLOAD = {
    team_id: 'T06Q92QGCLC',
    team_domain: 'mas',
    service_id: '6899401468119',
    channel_id: 'C06Q6525S71',
    channel_name: 'bridge-testing',
    timestamp: '1711628700.919889',
    user_id: 'U06QMMZQRH5',
    user_name: 'mario',
    text: 'incoming!'
};

describe("WebhookTest", () => {
    let harness: { hooks: SlackHookHandler, main: FakeMain };

    beforeEach(() => {
        harness = constructHarness();
    });

    async function checkResult(req: httpMocks.MockRequest<any>, expectations: (res: httpMocks.MockResponse<any>) => void): Promise<void> {
        const res = httpMocks.createResponse({ eventEmitter: require('events').EventEmitter });
        const promise = new Promise<void>((resolve, reject) => {
            res.on('end', () => {
                try {
                    expectations(res);
                    resolve();
                } catch (err: unknown) {
                    reject(err);
                }
            });
        });

        harness.hooks._onRequest(req, res);

        req.emit('end');

        return promise;
    }

    it("will ignore webhooks sent to unknown room", () => {
        const req = httpMocks.createRequest({
            method: 'POST',
            url: 'http://foo.bar/webhooks/' + randomstring.generate(32),
            params: DEFAULT_PAYLOAD,
        });

        return checkResult(req, res => {
            expect(res.statusCode).to.equal(200);
        });
    });

    it("will reject webhooks not containing a valid token", () => {
        let room = new BridgedRoom(harness.main as unknown as Main, {
            matrix_room_id: '!foo:bar.baz',
            inbound_id: randomstring.generate(32),
            slack_webhook_token: randomstring.generate(24),
            slack_type: "channel",
        });
        harness.main.rooms.upsertRoom(room);

        const req = httpMocks.createRequest({
            method: 'POST',
            url: 'http://foo.bar/webhooks/' + room.InboundId,
            params: {
                token: 'invalid',
                ...DEFAULT_PAYLOAD,
            },
        });

        return checkResult(req, res => {
            expect(res.statusCode).to.equal(403);
        });
    });
});
