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

import { default as subsitutions, replacementFromDisplayMap } from "../../substitutions";
import { expect } from "chai";

const displayMap = {
    "Alice": "U2222",
    "Bob": "U1111",
    "Bob Charlie": "U3333",
};

describe("Substitutions", () => {
    describe("replacementFromDisplayMap", () => {
        it("should replace a unique nick", () => {
            const newString = replacementFromDisplayMap("@Alice", displayMap);
            expect(newString).to.equal("<@U2222>");
        });
        it("should replace the shortest non-unique", () => {
            const newString = replacementFromDisplayMap("@Bob", displayMap);
            expect(newString).to.equal("<@U1111>");
        });
        it("should replace the longest non-unique", () => {
            const newString = replacementFromDisplayMap("@Bob Charlie", displayMap);
            expect(newString).to.equal("<@U3333>");
        });
    });
    describe("makeFirstWordMap", () => {
        const expectedFirstWords = {
            Alice: [{Alice: "U2222"}],
            Bob: [{Bob: "U1111"},
            {"Bob Charlie": "U3333"}],
        };
        it("should make the first word map", () => {
            const firstWords = subsitutions.makeFirstWordMap(displayMap);
            expect(firstWords).to.deep.equal(expectedFirstWords);
        });
    });
});
