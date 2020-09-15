
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

import { AllowDenyList, DenyReason } from "../../AllowDenyList";
import { expect } from "chai";


const BLOCKED_SLACK_USER = "block-slack";
const BLOCKED_SLACK_USERNAME = "block-slack-username";
const NOT_BLOCKED_SLACK_USER = "not-block-slack";

const BLOCKED_MATRIX_USER = "block-matrix";
const NOT_BLOCKED_MATRIX_USER = "not-block-matrix";

const BLOCKED_SLACK_CHANNEL_ID = "CBLOCKED";
const BLOCKED_SLACK_CHANNEL_NAME = "#blocked";
const ALLOWED_SLACK_CHANNEL_ID = "CALLOWED";
const ALLOWED_SLACK_CHANNEL_NAME = "#allowed";


describe("AllowDenyList", () => {
    describe("allowDM", () => {
        it("should not deny any users if no configuration is set", async () => {
            const adl = new AllowDenyList();
            expect(adl.allowDM(BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.ALLOWED);
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, NOT_BLOCKED_SLACK_USER)).to.equal(DenyReason.ALLOWED);
            expect(adl.allowDM(BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER, BLOCKED_SLACK_USERNAME)).to.equal(DenyReason.ALLOWED);
        });

        // Deny list
        it("should block matrix user if in deny list", async () => {
            const adl = new AllowDenyList({
                deny: {
                    matrix: [BLOCKED_MATRIX_USER]
                }
            });
            expect(adl.allowDM(BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.MATRIX);
        });
        it("should allow matrix user if not in deny list", async () => {
            const adl = new AllowDenyList({
                deny: {
                    matrix: [BLOCKED_MATRIX_USER]
                }
            });
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.ALLOWED);
        });
        it("should block slack user if in deny list", async () => {
            const adl = new AllowDenyList({
                deny: {
                    slack: [BLOCKED_SLACK_USER]
                }
            });
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.SLACK);
        });
        it("should block slack username if in deny list", async () => {
            const adl = new AllowDenyList({
                deny: {
                    slack: [BLOCKED_SLACK_USERNAME]
                }
            });
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER, BLOCKED_SLACK_USERNAME)).to.equal(DenyReason.SLACK);
        });

        // Allow List
        it("should deny any users if allow.matrix is set", async () => {
            const adl = new AllowDenyList({
                allow: {
                    matrix: ['will-not-match']
                }
            });
            expect(adl.allowDM("foo", "bar")).to.equal(DenyReason.MATRIX);
            expect(adl.allowDM(BLOCKED_MATRIX_USER, "bar")).to.equal(DenyReason.MATRIX);
            expect(adl.allowDM("foo", BLOCKED_SLACK_USER)).to.equal(DenyReason.MATRIX);
        });

        it("should deny any users if allow.slack is set", async () => {
            const adl = new AllowDenyList({
                allow: {
                    slack: ['will-not-match']
                }
            });
            expect(adl.allowDM("foo", "bar")).to.equal(DenyReason.SLACK);
            expect(adl.allowDM(BLOCKED_MATRIX_USER, "bar")).to.equal(DenyReason.SLACK);
            expect(adl.allowDM("foo", BLOCKED_SLACK_USER)).to.equal(DenyReason.SLACK);
        });

        it("should allow some users if if allow.matrix is set", async () => {
            const adl = new AllowDenyList({
                allow: {
                    matrix: [NOT_BLOCKED_MATRIX_USER]
                }
            });
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.ALLOWED);
            expect(adl.allowDM(BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.MATRIX);
        });

        it("should allow some users if allow.slack is set", async () => {
            const adl = new AllowDenyList({
                allow: {
                    slack: [NOT_BLOCKED_SLACK_USER]
                }
            });
            expect(adl.allowDM(BLOCKED_MATRIX_USER, NOT_BLOCKED_SLACK_USER)).to.equal(DenyReason.ALLOWED);
            expect(adl.allowDM(BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.SLACK);
        });

        // Mixed
        it("should block matrix user even if Slack user allowed", async () => {
            const adl = new AllowDenyList({
                allow: {
                    slack: [NOT_BLOCKED_SLACK_USER]
                },
                deny: {
                    matrix: [BLOCKED_MATRIX_USER]
                }
            });
            expect(adl.allowDM(BLOCKED_MATRIX_USER, NOT_BLOCKED_SLACK_USER)).to.equal(DenyReason.MATRIX);
        });

        it("should block Slack user even if matrix user allowed", async () => {
            const adl = new AllowDenyList({
                allow: {
                    matrix: [NOT_BLOCKED_MATRIX_USER]
                },
                deny: {
                    slack: [BLOCKED_SLACK_USER]
                }
            });
            expect(adl.allowDM(NOT_BLOCKED_MATRIX_USER, BLOCKED_SLACK_USER)).to.equal(DenyReason.SLACK);
        });
    });
    describe("allowChannel", () => {
        it("should not deny any channels if no configuration is set", async () => {
            const adl = new AllowDenyList();
            expect(adl.allowSlackChannel(ALLOWED_SLACK_CHANNEL_ID, ALLOWED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.ALLOWED);
            expect(adl.allowSlackChannel(BLOCKED_SLACK_CHANNEL_ID, BLOCKED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.ALLOWED);
        });

        // Deny

        it("should deny a channel by id", () => {
            const adl = new AllowDenyList({}, {
                deny: [
                    BLOCKED_SLACK_CHANNEL_ID
                ]
            });
            expect(adl.allowSlackChannel(BLOCKED_SLACK_CHANNEL_ID, ALLOWED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.SLACK);
        });

        it("should deny a channel by name", () => {
            const adl = new AllowDenyList({}, {
                deny: [
                    BLOCKED_SLACK_CHANNEL_NAME
                ]
            });
            expect(adl.allowSlackChannel(ALLOWED_SLACK_CHANNEL_ID, BLOCKED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.SLACK);
        });

        it("should allow a channel by id", () => {
            const adl = new AllowDenyList({}, {
                allow: [
                    ALLOWED_SLACK_CHANNEL_ID
                ]
            });
            expect(adl.allowSlackChannel(ALLOWED_SLACK_CHANNEL_ID, BLOCKED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.ALLOWED);
        });

        it("should allow a channel by name", () => {
            const adl = new AllowDenyList({}, {
                allow: [
                    ALLOWED_SLACK_CHANNEL_NAME
                ]
            });
            expect(adl.allowSlackChannel(BLOCKED_SLACK_CHANNEL_ID, ALLOWED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.ALLOWED);
        });

        it("should block a channel when only allow is specified", () => {
            const adl = new AllowDenyList({}, {
                allow: [
                    ALLOWED_SLACK_CHANNEL_ID
                ]
            });
            expect(adl.allowSlackChannel(BLOCKED_SLACK_CHANNEL_ID, BLOCKED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.SLACK);
        });

        it("should allow a channel when only deny is specified", () => {
            const adl = new AllowDenyList({}, {
                deny: [
                    BLOCKED_SLACK_CHANNEL_ID
                ]
            });
            expect(adl.allowSlackChannel(ALLOWED_SLACK_CHANNEL_ID, ALLOWED_SLACK_CHANNEL_NAME)).to.equal(DenyReason.ALLOWED);
        });
    });
});
