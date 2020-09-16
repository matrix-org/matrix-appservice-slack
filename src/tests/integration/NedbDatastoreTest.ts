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
import { expect } from "chai";
import { UserBridgeStore, RoomBridgeStore, EventBridgeStore } from "matrix-appservice-bridge";
import { NedbDatastore } from "../../datastore/NedbDatastore";
import NedbDs from "nedb";
import { doDatastoreTests } from "./SharedDatastoreTests";

describe("NedbDatastore", () => {
    let ds: NedbDatastore;
    let roomStore: RoomBridgeStore;
    let reactionStore: NedbDs;
    before(async () => {
        const userStore = new UserBridgeStore(new NedbDs());
        roomStore = new RoomBridgeStore(new NedbDs());
        const eventStore = new EventBridgeStore(new NedbDs());
        const teamStore = new NedbDs();
        reactionStore = new NedbDs();
        ds = new NedbDatastore(userStore, roomStore, eventStore, teamStore, reactionStore);
    });

    doDatastoreTests(() => ds, async () => {
        await roomStore.delete({});
        reactionStore.remove({});
    });

    describe("getAll… functions", () => {
        beforeEach(async () => {
            reactionStore.remove({});
        });

        it("should return an empty array if reactions table is empty", async () => {
            const reactions = await ds.getAllReactions()
            expect(reactions).to.deep.equal([]);
        });

        it("when two reactions were added, getAllReactions() should return an all reactions", async () => {
            const reaction1 = {
                roomId: "!foo1:bar",
                eventId: "$foo1:bar",
                slackChannelId: "F001",
                slackMessageTs: "BAR1",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            const reaction2 = {
                roomId: "!foo2:bar",
                eventId: "$foo2:bar",
                slackChannelId: "F002",
                slackMessageTs: "BAR2",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds.upsertReaction(reaction1);
            await ds.upsertReaction(reaction2);
            expect(await ds.getAllReactions()).to.have.deep.members([
                reaction1,
                reaction2,
            ]);
        });
    });
});
