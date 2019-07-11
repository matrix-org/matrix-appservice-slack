// tslint:disable: no-unused-expression no-any
import { BridgedRoom } from "../BridgedRoom";

describe("BridgedRoom", () => {
    it("constructs", () => {
        const br = new BridgedRoom({} as any, {
            inbound_id: "123456a",
            matrix_room_id: "!abcde:localhost",
        });
    });
});
