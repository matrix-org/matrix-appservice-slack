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

import { Provisioner } from "../../src/provisioning/Provisioner";
import { FakeMain } from "../utils/fakeMain";
import { expect } from "chai";
import { FakeExpressResponse } from "../utils/fakeExpress";

// eslint-disable-next-line max-len
const OAuthUrlRegex = /^https:\/\/slack\.com\/oauth\/authorize\?client_id=fakeid&redirect_uri=https%3A%2F%2Fredir_prefix%2F([0-9a-z-]+)%2Fauthorize&scope=(.*)&state=([0-9a-z-]+)$/;

const createProvisioner = (mainCfg?: any) => {
    const fakeMain = new FakeMain(mainCfg);
    const prov = new Provisioner(fakeMain as any, {} as any, {} as any);
    return {prov, fakeMain};
};

describe("Provisioning", () => {
    describe("commands.authurl", () => {
        it ("should not handle command with disabled oauth2", async () => {
            const { prov } = createProvisioner();
            const req = {
                userId: "@example:synapse.test",
                body: {},
            };
            const res = new FakeExpressResponse();
            let err;
            try {
                await prov.fakeRequest("getAuthUrl", req as any, res as any);
            } catch (e) {
                err = e;
            }
            expect(err.message).to.equal('API error M_AS_UNSUPPORTED_OPERATION: OAuth2 is not configured on this bridge');
        });
        it ("should handle command with missing puppeting parameter", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                userId: "@example:synapse.test",
                body: {},
            };
            const res = new FakeExpressResponse();
            await prov.fakeRequest("getAuthUrl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri as string);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "bot%2Cchannels%3Ahistory%2Cchannels%3Aread%2Cchat%3Awrite%3Abot%2Cfiles%3Awrite%3Auser%2Creactions%3Awrite%2Cteam%3Aread%2Cusers%3Aread",
            );
        });
        it ("should handle command with puppeting parameter set to false", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                userId: "@example:synapse.test",
                body: {
                    puppeting: "false",
                },
            };
            const res = new FakeExpressResponse();
            await prov.fakeRequest("getAuthUrl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri as string);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "bot%2Cchannels%3Ahistory%2Cchannels%3Aread%2Cchat%3Awrite%3Abot%2Cfiles%3Awrite%3Auser%2Creactions%3Awrite%2Cteam%3Aread%2Cusers%3Aread",
            );
        });
        it ("should handle command with puppeting parameter set to true", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                userId: "@example:synapse.test",
                body: {
                    puppeting: "true",
                },
            };
            const res = new FakeExpressResponse();
            await prov.fakeRequest("getAuthUrl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri as string);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "client",
            );
        });
    });
});
