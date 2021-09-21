export class FakeIntent {
    public resolveRoom(alias: string) {
        if (alias === "#working:localhost") {
            return "!working:localhost";
        }
        if (alias === "#working2:localhost") {
            return "!alsoworking:localhost";
        }
        throw Error("Test says no room found");
    }
}
