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
import { Datastore } from "../../datastore/Models";
import { MatrixUser } from "matrix-appservice-bridge";
import { expect } from "chai";
import { SlackGhost } from "../../SlackGhost";
import { BridgedRoom } from "../../BridgedRoom";

// tslint:disable: no-unused-expression no-any

export const doDatastoreTests = (ds: () => Datastore, truncateTables: () => void) => {
    describe("users", () => {
        it("should return null if a matrix user is not found", async () => {
            const userEntry = await ds().getUser("notreal");
            expect(userEntry).to.be.null;
        });

        it("should be able to store and retrieve a slack user", async () => {
            await ds().upsertUser(
                SlackGhost.fromEntry(null as any, {
                    display_name: "A displayname",
                    avatar_url: "Some avatar",
                    id: "someid1",
                    slack_id: "FOOBAR",
                    team_id: "BARBAZ",
                }, null),
            );
            const userEntry = await ds().getUser("someid1");
            expect(userEntry).to.deep.equal({
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid1",
                slack_id: "FOOBAR",
                team_id: "BARBAZ",
            });
        });

        it("should be able to upsert a slack user", async () => {
            const user = SlackGhost.fromEntry(null as any, {
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid3",
                slack_id: "FOOBAR",
                team_id: "BARBAZ",
            }, null);
            await ds().upsertUser(user);
            (user as any).displayname = "A changed displayname";
            await ds().upsertUser(user);
            const userEntry = await ds().getUser("someid3");
            expect(userEntry).to.deep.equal({
                display_name: "A changed displayname",
                avatar_url: "Some avatar",
                id: "someid3",
                slack_id: "FOOBAR",
                team_id: "BARBAZ",
            });
        });

        it("should return null if a matrix user is not found", async () => {
            const userEntry = await ds().getMatrixUser("notreal");
            expect(userEntry).to.be.null;
        });

        it("should be able to store and retrieve a matrix user", async () => {
            const matrixUser = new MatrixUser("@foo1:bar", { some: "data"});
            await ds().storeMatrixUser(matrixUser);
            const response = await ds().getMatrixUser("@foo1:bar");
            expect(response.userId).to.equal("@foo1:bar");
            expect(response.serialize()).to.deep.equal({
                some: "data",
                localpart: "foo1",
            });
        });

        it("should be able to upsert a matrix user", async () => {
            const matrixUser = new MatrixUser("@foo2:bar", { some: "data"});
            await ds().storeMatrixUser(matrixUser);
            matrixUser.set("accounts", {
                someteamid: {
                    token: "some kind of token",
                },
            });
            await ds().storeMatrixUser(matrixUser);
            const response = await ds().getMatrixUser("@foo2:bar");
            expect(response.userId).to.equal("@foo2:bar");
            expect(response.serialize()).to.deep.equal({
                some: "data",
                localpart: "foo2",
                accounts: {
                    someteamid: {
                        token: "some kind of token",
                    },
                },
            });
        });
    });

    describe("events", () => {
        it("should insert and retrieve a event (model)", async () => {
            const model = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackTs: "BAR",
                _extras: {
                    slackThreadMessages: ["foo"],
                },
            };
            await ds().upsertEvent(model);
            expect(await ds().getEventByMatrixId("!foo:bar", "$foo:bar")).to.deep.equal(model, "Could not find by matrix id");
            expect(await ds().getEventBySlackId("F00", "BAR")).to.deep.equal(model, "Could not find by Slack id");
        });

        it("should insert and retrieve a event", async () => {
            const model = {
                roomId: "!foo3:bar",
                eventId: "$foo3:bar",
                slackChannelId: "F003",
                slackTs: "BAR3",
                _extras: {
                    slackThreadMessages: ["foo"],
                },
            };
            await ds().upsertEvent(model.roomId, model.eventId, model.slackChannelId, model.slackTs, model._extras);
            expect(await ds().getEventByMatrixId("!foo3:bar", "$foo3:bar")).to.deep.equal(model, "Could not find by matrix id");
            expect(await ds().getEventBySlackId("F003", "BAR3")).to.deep.equal(model, "Could not find by Slack id");
        });

        it("should be able to upsert an events slack threads", async () => {
            const model = {
                roomId: "!foo2:bar",
                eventId: "$foo2:bar",
                slackChannelId: "F002",
                slackTs: "BAR2",
                _extras: {
                    slackThreadMessages: ["abc"],
                },
            };
            model._extras.slackThreadMessages.push("def");
            await ds().upsertEvent(model);
            expect((await ds().getEventByMatrixId("!foo2:bar", "$foo2:bar"))!._extras).to.deep.equal(model._extras);
            model._extras.slackThreadMessages.push("ghi");
            await ds().upsertEvent(model);
            expect((await ds().getEventByMatrixId("!foo2:bar", "$foo2:bar"))!._extras).to.deep.equal(model._extras);
            model._extras.slackThreadMessages.splice(0, 3);
            await ds().upsertEvent(model);
            expect((await ds().getEventByMatrixId("!foo2:bar", "$foo2:bar"))!._extras).to.deep.equal(model._extras);
        });
    });

    describe("rooms", () => {
        afterEach(truncateTables);

        it("should return an empty array if rooms table is empty", async () => {
            expect(await ds().getAllRooms()).to.be.empty;
        });

        it("should insert and retrieve a room", async () => {
            const room = new BridgedRoom({} as any, {
                inbound_id: "a_remote_id",
                matrix_room_id: "a_matrix_id",
                slack_channel_id: "a_channel_id",
                slack_channel_name: "a_channel_name",
                slack_team_id: "a_team_id",
                slack_webhook_uri: "a_webhook_uri",
                puppet_owner: "foobar",
                slack_type: "unknown",
            }, {} as any);
            await ds().upsertRoom(room);
            const rooms = await ds().getAllRooms();
            expect(rooms[0]).to.deep.equal(room.toEntry());
        });

        it("should insert, upsert and retrieve a room", async () => {
            const room = new BridgedRoom({} as any, {
                inbound_id: "a_remote_id_upserted",
                matrix_room_id: "a_matrix_id",
                slack_channel_id: "a_channel_id",
                slack_channel_name: "a_channel_name",
                slack_team_id: "a_team_id",
                slack_webhook_uri: "a_webhook_uri",
                puppet_owner: "foobar",
                slack_type: "unknown",
            }, {} as any);
            await ds().upsertRoom(room);
            room.SlackChannelName = "new_channel_name";
            await ds().upsertRoom(room);
            const rooms = await ds().getAllRooms();
            expect(rooms[0]).to.deep.equal(room.toEntry());
        });

        it("should be able to find many rooms", async () => {
            for (let i = 0; i < 20; i++) {
                const room = new BridgedRoom({} as any, {
                    inbound_id: "a_remote_id" + i,
                    matrix_room_id: "a_matrix_id",
                    slack_channel_id: "a_channel_id",
                    slack_channel_name: "a_channel_name",
                    slack_team_id: "a_team_id",
                    slack_webhook_uri: "a_webhook_uri",
                    puppet_owner: undefined,
                    slack_type: "unknown",
                }, {} as any);
                await ds().upsertRoom(room);
            }
            const rooms = await ds().getAllRooms();
            expect(rooms).to.have.lengthOf(20); // Account for the last test
        });
    });

    describe("teams", () => {
        it("should insert and retrieve a team", async () => {
            await ds().upsertTeam({
                id: "12345team",
                bot_token: "some_bot_token",
                name: "a_team_name",
                user_id: "team_user_id",
                bot_id: "bot_id",
                domain: "foo.bar",
                scopes: "foo,bar",
                status: "bad_auth",
            });
            const team = await ds().getTeam("12345team");
            expect(team).to.deep.equal({
                id: "12345team",
                bot_token: "some_bot_token",
                name: "a_team_name",
                user_id: "team_user_id",
                bot_id: "bot_id",
                domain: "foo.bar",
                scopes: "foo,bar",
                status: "bad_auth",
            });
        });

        it("should insert, upsert and retrieve a team", async () => {
            await ds().upsertTeam({
                id: "12345team",
                bot_token: "some_bot_token",
                name: "a_team_name",
                user_id: "team_user_id",
                bot_id: "bot_id",
                domain: "foo.bar",
                scopes: "foo,bar",
                status: "bad_auth",
            });
            await ds().upsertTeam({
                id: "12345team",
                bot_token: "another_bot_token",
                name: "another_team_name",
                user_id: "another_user_id",
                bot_id: "bot_id",
                domain: "another:foo.bar",
                scopes: "another:foo,bar",
                status: "ok",
            });
            const team = await ds().getTeam("12345team");
            expect(team).to.deep.equal({
                id: "12345team",
                bot_token: "another_bot_token",
                name: "another_team_name",
                user_id: "another_user_id",
                bot_id: "bot_id",
                domain: "another:foo.bar",
                scopes: "another:foo,bar",
                status: "ok",
            });
        });
    });

    describe("reactions", () => {
        afterEach(truncateTables);

        it("should insert and retrieve a reaction by its Matrix identifiers", async () => {
            const entry = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackMessageTs: "BAR",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds().upsertReaction(entry);
            const reaction = await ds().getReactionByMatrixId(entry.roomId, entry.eventId);
            expect(reaction).to.deep.equal(entry);
        });
        it("should insert and retrieve a reaction by its Slack identifiers", async () => {
            const entry = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackMessageTs: "BAR",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds().upsertReaction(entry);
            const reaction = await ds().getReactionBySlackId(entry.slackChannelId, entry.slackMessageTs, entry.slackUserId, entry.reaction);
            expect(reaction).to.deep.equal(entry);
        });
        it("should insert and delete a reaction by its Matrix identifiers", async () => {
            const entry = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackMessageTs: "BAR",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds().upsertReaction(entry);
            await ds().deleteReactionByMatrixId(entry.roomId, entry.eventId);
            const reaction = await ds().getReactionByMatrixId(entry.roomId, entry.eventId);
            expect(reaction).to.be.null;
        });
        it("should insert and delete a reaction by its Slack identifiers", async () => {
            const entry = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackMessageTs: "BAR",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds().upsertReaction(entry);
            await ds().deleteReactionBySlackId(entry.slackChannelId, entry.slackMessageTs, entry.slackUserId, entry.reaction);
            const reaction = await ds().getReactionBySlackId(entry.slackChannelId, entry.slackMessageTs, entry.slackUserId, entry.reaction);
            expect(reaction).to.be.null;
        });
        it("should not throw when an reaction is upserted twice", async () => {
            const entry = {
                roomId: "!foo:bar",
                eventId: "$foo:bar",
                slackChannelId: "F00",
                slackMessageTs: "BAR",
                slackUserId: "U010AAR88B1",
                reaction: "hugging_face",
            };
            await ds().upsertReaction(entry);
            await ds().upsertReaction(entry);
        });
    });

    describe("metrics", () => {
        it("should not throw when an activity is upserted twice", async () => {
            const user = SlackGhost.fromEntry(null as any, {
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid1",
                slack_id: "FOOBAR",
                team_id: "BARBAZ",
            }, null);
            const room = new BridgedRoom({} as any, {
                inbound_id: "a_remote_id",
                matrix_room_id: "a_matrix_id",
                slack_channel_id: "a_channel_id",
                slack_channel_name: "a_channel_name",
                slack_team_id: "a_team_id",
                slack_webhook_uri: "a_webhook_uri",
                puppet_owner: undefined,
                slack_type: "unknown",
            }, {} as any);
            const date = new Date();
            await ds().upsertActivityMetrics(user, room, date);
            await ds().upsertActivityMetrics(user, room, date);
        });
    });
};
