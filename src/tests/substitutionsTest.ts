// tslint:disable: no-unused-expression

import { default as subsitutions, replacementFromDisplayMap } from "../substitutions";
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
