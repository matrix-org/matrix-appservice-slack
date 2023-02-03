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

import { SlackHookHandler } from "../../src/SlackHookHandler";
import { expect } from "chai";

describe("SlackHookHandler", () => {
    it("getUrlParts should accept a id without a path", () => {
        const { inboundId, path } = SlackHookHandler.getUrlParts("0337a838-2fec-4b79-8186-8111f781");
        expect(inboundId).to.equal("0337a838-2fec-4b79-8186-8111f781");
        expect(path).to.equal("post");
    });
    it("getUrlParts should accept a id followed by a path", () => {
        const { inboundId, path } = SlackHookHandler.getUrlParts("0337a838-2fec-4b79-8186-8111f781/authorize");
        expect(inboundId).to.equal("0337a838-2fec-4b79-8186-8111f781");
        expect(path).to.equal("authorize");
    });
    it("getUrlParts should accept a id followed by a path and parameters", () => {
        const { inboundId, path } = SlackHookHandler.getUrlParts(
            "0337a838-2fec-4b79-8186-8111f781/authorize?code=123123123.213123&state=123123-asdasd-21",
        );
        expect(inboundId).to.equal("0337a838-2fec-4b79-8186-8111f781");
        expect(path).to.equal("authorize?code=123123123.213123&state=123123-asdasd-21");
    });
    it("getUrlParts should accept a id with a prefix", () => {
        const { inboundId, path } = SlackHookHandler.getUrlParts(
            "/my/slack/prefix/0337a838-2fec-4b79-8186-8111f781/authorize?code=123123123.213123&state=123123-asdasd-21",
        );
        expect(inboundId).to.equal("0337a838-2fec-4b79-8186-8111f781");
        expect(path).to.equal("authorize?code=123123123.213123&state=123123-asdasd-21");
    });
    it("getUrlParts should accept a id with a prefix without a slash", () => {
        const { inboundId, path } = SlackHookHandler.getUrlParts(
            "my/slack/prefix/0337a838-2fec-4b79-8186-8111f781/authorize?code=123123123.213123&state=123123-asdasd-21",
        );
        expect(inboundId).to.equal("0337a838-2fec-4b79-8186-8111f781");
        expect(path).to.equal("authorize?code=123123123.213123&state=123123-asdasd-21");
    });
    it("getUrlParts should throw on an empty string", () => {
        expect(() => {
            SlackHookHandler.getUrlParts("");
        }).to.throw;
    });
    it("getUrlParts should throw on an /", () => {
        expect(() => {
            SlackHookHandler.getUrlParts("/");
        }).to.throw;
    });
});
