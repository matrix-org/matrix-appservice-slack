var subsitutions = require("../lib/substitutions");

describe ("Plain Text Mentions", () => {
    var displaymap = {Stuart: "U1111", Cadair: "U2222", "Stuart Mumford": "U3333"}
    it("replace unique nick", () => {
        var new_string = subsitutions.replacementFromDisplayMap("@Cadair", displaymap);
        expect(new_string).toBe("<@U2222>");
    });
    it("replace shortest non-unique", () => {
        var new_string = subsitutions.replacementFromDisplayMap("@Stuart", displaymap);
        expect(new_string).toBe("<@U1111>");
    });
    it("replace longest non-unique", () => {
        var new_string = subsitutions.replacementFromDisplayMap("@Stuart Mumford", displaymap);
        expect(new_string).toBe("<@U3333>");
    });
})

describe ("Make First Word Map", () => {
    var displaymap = {Stuart: "U1111", Cadair: "U2222", "Stuart Mumford": "U3333"}
    var expectedfirstwords = {Stuart: [{Stuart: "U1111"}, {"Stuart Mumford": "U3333"}],
                              Cadair: [{Cadair: "U2222"}]};
    it("Make the First Word Map", () => {
        var firstwords = subsitutions.makeFirstWordMap(displaymap);
        expect(firstwords).toEqual(expectedfirstwords);
    });
})