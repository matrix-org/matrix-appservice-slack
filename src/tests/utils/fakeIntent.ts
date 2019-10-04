export class FakeIntent {
    public getClient() {
        return {
            getRoomIdForAlias: this.cliGetRoomIdForAlias.bind(this),
        };
    }

    private cliGetRoomIdForAlias(alias: string) {
        if (alias === "#working:localhost") {
            return { room_id: "!working:localhost" };
        }
        if (alias === "#working2:localhost") {
            return { room_id: "!alsoworking:localhost" };
        }
        throw Error("Test says no room found");
    }
}
