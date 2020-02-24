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

import { Provisioner } from "../../Provisioning";
import { FakeMain } from "../utils/fakeMain";
import { expect } from "chai";
import { FakeExpressResponse } from "../utils/fakeExpress";

// tslint:disable-next-line: max-line-length
const OAuthUrlRegex = /^https:\/\/slack\.com\/oauth\/authorize\?client_id=fakeid&redirect_uri=redir_prefix([0-9a-z-]+)%2Fauthorize&scope=(.*)&state=([0-9a-z-]+)$/;

function createProvisioner(mainCfg?: any) {
    const fakeMain = new FakeMain(mainCfg);
    const prov = new Provisioner(fakeMain as any, {});
    return {prov, fakeMain};
}

describe("Provisioning", () => {
    describe("commands.authurl", () => {
        it ("should not handle command with missing body parameters", async () => {
            const { prov } = createProvisioner()
            const req = {
                body: { },
            };
            const res = new FakeExpressResponse();
            await prov.handleProvisioningRequest("authurl", req as any, res as any);
            expect(res.Status).to.equal(400);
            expect(res.Json).to.deep.equal({
                error: "Required parameter user_id missing",
            });
        });
        it ("should not handle command with disabled oauth2", async () => {
            const { prov } = createProvisioner();
            const req = {
                body: {
                    user_id: "foobar",
                },
            };
            const res = new FakeExpressResponse();
            await prov.handleProvisioningRequest("authurl", req as any, res as any);
            expect(res.Status).to.equal(400);
            expect(res.Json).to.deep.equal({
                error: "OAuth2 not configured on this bridge",
            });
        });
        it ("should handle command with missing puppeting body parameter", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                body: {
                    user_id: "foobar",
                },
            };
            const res = new FakeExpressResponse();
            await prov.handleProvisioningRequest("authurl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "team%3Aread%2Cusers%3Aread%2Cchannels%3Ahistory%2Cchannels%3Aread%2Cfiles%3Awrite%3Auser%2Cchat%3Awrite%3Abot%2Cusers%3Aread%2Cbot",
            );
        });
        it ("should handle command with missing puppeting body parameter set to false", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                body: {
                    user_id: "foobar",
                    puppeting: "false",
                },
            };
            const res = new FakeExpressResponse();
            await prov.handleProvisioningRequest("authurl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "team%3Aread%2Cusers%3Aread%2Cchannels%3Ahistory%2Cchannels%3Aread%2Cfiles%3Awrite%3Auser%2Cchat%3Awrite%3Abot%2Cusers%3Aread%2Cbot",
            );
        });
        it ("should handle command with missing puppeting body parameter set to true", async () => {
            const { prov } = createProvisioner({ oauth2: true });
            const req = {
                body: {
                    user_id: "foobar",
                    puppeting: "true",
                },
            };
            const res = new FakeExpressResponse();
            await prov.handleProvisioningRequest("authurl", req as any, res as any);
            expect(res.Status).to.equal(200);
            expect(res.Json).to.exist;
            const match = OAuthUrlRegex.exec(res.Json.auth_uri);
            expect(match).is.not.null;
            expect(match![1]).to.equal(match![3]);
            expect(match![2]).to.equal(
                "client",
            );
        });
    });
});
