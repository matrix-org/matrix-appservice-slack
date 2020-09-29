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

import { expect } from "chai";
import { BridgedRoom, emojifyReaction } from "../../BridgedRoom";

describe("BridgedRoom", () => {
    it("constructs", () => {
        new BridgedRoom({} as any, {
            inbound_id: "123456a",
            matrix_room_id: "!abcde:localhost",
            slack_type: "unknown",
        });
    });
});

describe("emojifyReaction", () => {
    describe("Ends with Variant Selector 16", () => {
        it("On former quick reactions", () => {
            expect(emojifyReaction(':thumbsup:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':thumbsdown:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':rocket:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':heart:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':tada:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':eyes:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':smile:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':confused:')).to.match(/\ufe0f$/);
        });
        it("On other emojis", () => {
            expect(emojifyReaction(':female-police-officer:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':male-singer:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':construction_worker:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':flag-ca:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':tm:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':electric_plug:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':clock430:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':metro:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':dog:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':woman-woman-boy-boy:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':mage:')).to.match(/\ufe0f$/);
        });
        it("On emoji sequences", () => {
            expect(emojifyReaction(':male-farmer::skin-tone-2:')).to.match(/\ufe0f$/);
            expect(emojifyReaction(':dancer::skin-tone-6:')).to.match(/\ufe0f$/);
        });
    });
    describe("Doesn't contain a Variant Selector 16 other than at the end", () => {
        it("On former quick reactions", () => {
            expect(emojifyReaction(':thumbsup:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':thumbsdown:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':rocket:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':heart:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':tada:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':eyes:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':smile:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':confused:')).to.match(/^[^\ufe0f]*.$/);
        });
        it("On other emojis", () => {
            expect(emojifyReaction(':female-police-officer:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':male-singer:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':construction_worker:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':flag-ca:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':tm:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':electric_plug:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':clock430:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':metro:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':dog:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':woman-woman-boy-boy:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':mage:')).to.match(/^[^\ufe0f]*.$/);
        });
        it("On emoji sequences", () => {
            expect(emojifyReaction(':male-farmer::skin-tone-2:')).to.match(/^[^\ufe0f]*.$/);
            expect(emojifyReaction(':dancer::skin-tone-6:')).to.match(/^[^\ufe0f]*.$/);
        });
    });
    it("Returns the same string when no emoji with that name exists", () => {
        expect(emojifyReaction(':notanemoji:')).to.equal(':notanemoji:');
    });
});
