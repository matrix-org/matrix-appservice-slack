const subsitutions = require("../lib/substitutions");

describe ("Plain Text Mentions", () => {
    const displaymap = {Stuart: "U1111", Cadair: "U2222", "Stuart Mumford": "U3333"}
    it("replace unique nick", () => {
        const new_string = subsitutions.replacementFromDisplayMap("@Cadair", displaymap);
        expect(new_string).toBe("<@U2222>");
    });
    it("replace shortest non-unique", () => {
        const new_string = subsitutions.replacementFromDisplayMap("@Stuart", displaymap);
        expect(new_string).toBe("<@U1111>");
    });
    it("replace longest non-unique", () => {
        const new_string = subsitutions.replacementFromDisplayMap("@Stuart Mumford", displaymap);
        expect(new_string).toBe("<@U3333>");
    });
})

describe ("Make First Word Map", () => {
    const displaymap = {Stuart: "U1111", Cadair: "U2222", "Stuart Mumford": "U3333"}
    const expectedfirstwords = {Stuart: [{Stuart: "U1111"}, {"Stuart Mumford": "U3333"}],
                                Cadair: [{Cadair: "U2222"}]};
    it("Make the First Word Map", () => {
        const firstwords = subsitutions.makeFirstWordMap(displaymap);
        expect(firstwords).toEqual(expectedfirstwords);
    });
})