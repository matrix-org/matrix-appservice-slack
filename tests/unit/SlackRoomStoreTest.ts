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

import { SlackRoomStore } from "../../src/SlackRoomStore";
import { expect } from "chai";
import { BridgedRoom } from "../../src/BridgedRoom";

describe("SlackRoomStore", () => {
    it("should construct", () => {
        const roomStore = new SlackRoomStore();
        expect(roomStore.all).to.be.empty;
        expect(roomStore.matrixRoomCount).to.equal(0);
        expect(roomStore.remoteRoomCount).to.equal(0);
    });

    it ("should be able to upsert a room without a channelId", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);

        expect(roomStore.getByInboundId("foo")).to.equal(room);
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.equal(room);
        expect(roomStore.matrixRoomCount).to.equal(1);
        expect(roomStore.remoteRoomCount).to.equal(1);
        expect(roomStore.all).to.have.lengthOf(1);
    });

    it ("should be able to upsert a room with a channel_id", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_channel_id: "bar",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);

        expect(roomStore.getByInboundId("foo")).to.equal(room);
        expect(roomStore.getBySlackChannelId("bar")).to.equal(room);
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.equal(room);
        expect(roomStore.matrixRoomCount).to.equal(1);
        expect(roomStore.remoteRoomCount).to.equal(1);
        expect(roomStore.all).to.have.lengthOf(1);
    });

    it ("should be able to upsert a room multiple times", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_channel_id: "bar",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);
        roomStore.upsertRoom(room);
        roomStore.upsertRoom(room);
        roomStore.upsertRoom(room);
        roomStore.upsertRoom(room);

        expect(roomStore.getByInboundId("foo")).to.equal(room);
        expect(roomStore.getBySlackChannelId("bar")).to.equal(room);
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.equal(room);
        expect(roomStore.matrixRoomCount).to.equal(1);
        expect(roomStore.remoteRoomCount).to.equal(1);
        expect(roomStore.all).to.have.lengthOf(1);
    });

    it ("should be able to upsert many rooms", () => {
        const roomStore = new SlackRoomStore();
        const rooms: BridgedRoom[] = [];
        for (let i = 0; i < 5; i++) {
            rooms.push(new BridgedRoom(null as any, {
                matrix_room_id: "!foo:bar" + i,
                inbound_id: "foo" + i,
                slack_channel_id: "bar" + i,
                slack_type: "unknown",
            }));
            roomStore.upsertRoom(rooms[i]);
        }

        for (let i = 0; i < 5; i++) {
            expect(roomStore.getByInboundId("foo" + i)).to.equal(rooms[i]);
            expect(roomStore.getBySlackChannelId("bar" + i)).to.equal(rooms[i]);
            expect(roomStore.getByMatrixRoomId("!foo:bar" + i)).to.equal(rooms[i]);
        }

        expect(roomStore.matrixRoomCount).to.equal(5);
        expect(roomStore.remoteRoomCount).to.equal(5);
        expect(roomStore.all).to.have.lengthOf(5);
    });

    it ("should be able to upsert a room, change it's channel_id, and find it", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_channel_id: "bar",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);
        room.SlackChannelId = "baz";
        roomStore.upsertRoom(room);
        expect(roomStore.getByInboundId("foo")).to.equal(room);
        expect(roomStore.getBySlackChannelId("baz")).to.equal(room);
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.equal(room);
        expect(roomStore.matrixRoomCount).to.equal(1);
        expect(roomStore.remoteRoomCount).to.equal(1);
        expect(roomStore.all).to.have.lengthOf(1);
    });

    it ("should be able to upsert a room, change it's inbound_id, and find it", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_channel_id: "bar",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);
        room.InboundId = "baz";
        roomStore.upsertRoom(room);
        expect(roomStore.getByInboundId("baz")).to.equal(room);
        expect(roomStore.getBySlackChannelId("bar")).to.equal(room);
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.equal(room);
        expect(roomStore.matrixRoomCount).to.equal(1);
        expect(roomStore.remoteRoomCount).to.equal(1);
        expect(roomStore.all).to.have.lengthOf(1);
    });

    it ("should be able to delete a room without a channel_id", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_type: "unknown",
        });
        roomStore.upsertRoom(room);
        roomStore.removeRoom(room);
        expect(roomStore.getByInboundId("foo")).to.be.undefined;
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.be.undefined;
        expect(roomStore.matrixRoomCount).to.equal(0);
        expect(roomStore.remoteRoomCount).to.equal(0);
        expect(roomStore.all).to.have.lengthOf(0);
    });

    it ("should be able to delete a room with a channel_id", () => {
        const roomStore = new SlackRoomStore();
        const room = new BridgedRoom(null as any, {
            matrix_room_id: "!foo:bar",
            inbound_id: "foo",
            slack_type: "unknown",
            slack_channel_id: "bar",
        });
        roomStore.upsertRoom(room);
        roomStore.removeRoom(room);
        expect(roomStore.getByInboundId("foo")).to.be.undefined;
        expect(roomStore.getBySlackChannelId("bar")).to.be.undefined;
        expect(roomStore.getByMatrixRoomId("!foo:bar")).to.be.undefined;
        expect(roomStore.matrixRoomCount).to.equal(0);
        expect(roomStore.remoteRoomCount).to.equal(0);
        expect(roomStore.all).to.have.lengthOf(0);
    });
});
