// tslint:disable: no-unused-expression

import { default as subsitutions, replacementFromDisplayMap } from "../substitutions";
import { expect } from "chai";

const displayMap = {
    "Cadair": "U2222",
    "Stuart": "U1111",
    "Stuart Mumford": "U3333",
};

describe("Substitutions", () => {
    describe("replacementFromDisplayMap", () => {
        it("should replace a unique nick", () => {
            const newString = replacementFromDisplayMap("@Cadair", displayMap);
            expect(newString).to.equal("<@U2222>");
        });
        it("should replace the shortest non-unique", () => {
            const newString = replacementFromDisplayMap("@Stuart", displayMap);
            expect(newString).to.equal("<@U1111>");
        });
        it("should replace the longest non-unique", () => {
            const newString = replacementFromDisplayMap("@Stuart Mumford", displayMap);
            expect(newString).to.equal("<@U3333>");
        });
    });
    describe("makeFirstWordMap", () => {
        const expectedFirstWords = {
            Cadair: [{Cadair: "U2222"}],
            Stuart: [{Stuart: "U1111"},
            {"Stuart Mumford": "U3333"}],
        };
        it("should make the first word map", () => {
            const firstWords = subsitutions.makeFirstWordMap(displayMap);
            expect(firstWords).to.deep.equal(expectedFirstWords);
        });
    });
});
