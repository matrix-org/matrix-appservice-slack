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
import { UserBridgeStore, RoomBridgeStore, EventBridgeStore } from "matrix-appservice-bridge";
import { NedbDatastore } from "../../datastore/NedbDatastore";
import * as NedbDs from "nedb";
import { doDatastoreTests } from "./SharedDatastoreTests";

describe("NedbDatastore", () => {
    let ds: NedbDatastore;
    let roomStore: RoomBridgeStore;
    before(async () => {
        const userStore = new UserBridgeStore(new NedbDs());
        roomStore = new RoomBridgeStore(new NedbDs());
        const eventStore = new EventBridgeStore(new NedbDs());
        const teamStore = new NedbDs();
        ds = new NedbDatastore(userStore, roomStore, eventStore, teamStore);
    });

    doDatastoreTests(() => ds, async () => {
        await roomStore.delete({});
    });
});
