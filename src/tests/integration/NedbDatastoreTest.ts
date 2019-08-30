import { UserBridgeStore, RoomBridgeStore, EventBridgeStore } from "matrix-appservice-bridge";
import { NedbDatastore } from "../../datastore/NedbDatastore";
import * as NedbDs from "nedb";
import { doDatastoreTests } from "./SharedDatastoreTests";

describe("NedbDatastore", () => {
    let ds: NedbDatastore;
    let roomStore: RoomBridgeStore;
    before(async () => {
        const users = new UserBridgeStore(new NedbDs());
        roomStore = new RoomBridgeStore(new NedbDs());
        const events = new EventBridgeStore(new NedbDs());
        const teams = new NedbDs();
        ds = new NedbDatastore(users, roomStore, events, teams);
    });

    doDatastoreTests(() => ds, async () => {
        await roomStore.delete({});
    });
});
