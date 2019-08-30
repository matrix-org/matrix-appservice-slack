import { Datastore } from "../../datastore/Models";
import { MatrixUser } from "matrix-appservice-bridge";
import { expect } from "chai";
import { SlackGhost } from "../../SlackGhost";
import { BridgedRoom } from "../../BridgedRoom";

// tslint:disable: no-unused-expression no-any
export const doDatastoreTests = (ds: () => Datastore, roomsAfterEach: () => void) => {
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
                }, null),
            );
            const userEntry = await ds().getUser("someid1");
            expect(userEntry).to.deep.equal({
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid1",
            });
        });

        it("should be able to upsert a slack user", async () => {
            const user = SlackGhost.fromEntry(null as any, {
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid2",
            }, null);
            await ds().upsertUser(user);
            (user as any).displayName = "A changed displayname";
            await ds().upsertUser(user);
            const userEntry = await ds().getUser("someid2");
            expect(userEntry).to.deep.equal({
                display_name: "A changed displayname",
                avatar_url: "Some avatar",
                id: "someid2",
            });
        });

        it("should be able to upsert a slack user", async () => {
            const user = SlackGhost.fromEntry(null as any, {
                display_name: "A displayname",
                avatar_url: "Some avatar",
                id: "someid3",
            }, null);
            await ds().upsertUser(user);
            (user as any).displayName = "A changed displayname";
            await ds().upsertUser(user);
            const userEntry = await ds().getUser("someid3");
            expect(userEntry).to.deep.equal({
                display_name: "A changed displayname",
                avatar_url: "Some avatar",
                id: "someid3",
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
            expect(await ds().getEventBySlackId("F00", "BAR")).to.deep.equal(model, "Could not find by slack id");
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
            expect(await ds().getEventBySlackId("F003", "BAR3")).to.deep.equal(model, "Could not find by slack id");
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
        it("should return an empty array if room table is empty", async () => {
            expect(await ds().getAllRooms()).to.be.empty;
        });

        afterEach(roomsAfterEach);

        it("should insert and retrieve a room", async () => {
            const room = new BridgedRoom({} as any, {
                access_scopes: new Set(["fooo", "bar"]),
                access_token: "access_token_foo",
                inbound_id: "a_remote_id",
                matrix_room_id: "a_matrix_id",
                slack_bot_id: "a_bot_id",
                slack_bot_token: "a_bot_token",
                slack_channel_id: "a_channel_id",
                slack_channel_name: "a_channel_name",
                slack_team_domain: "a_team_domain",
                slack_team_id: "a_team_id",
                slack_user_id: "a_user_id",
                slack_user_token: "a_user_token",
                slack_webhook_uri: "a_webhook_uri",
            }, {} as any);
            await ds().upsertRoom(room);
            const rooms = await ds().getAllRooms();
            expect(rooms[0]).to.deep.equal(room.toEntry());
        });

        it("should insert, upsert and retrieve a room", async () => {
            const room = new BridgedRoom({} as any, {
                access_scopes: new Set(["fooo", "bar"]),
                access_token: "access_token_foo",
                inbound_id: "a_remote_id_upserted",
                matrix_room_id: "a_matrix_id",
                slack_bot_id: "a_bot_id",
                slack_bot_token: "a_bot_token",
                slack_channel_id: "a_channel_id",
                slack_channel_name: "a_channel_name",
                slack_team_domain: "a_team_domain",
                slack_team_id: "a_team_id",
                slack_user_id: "a_user_id",
                slack_user_token: "a_user_token",
                slack_webhook_uri: "a_webhook_uri",
            }, {} as any);
            await ds().upsertRoom(room);
            room.SlackTeamDomain = "new_team_domain";
            await ds().upsertRoom(room);
            const rooms = await ds().getAllRooms();
            expect(rooms[0]).to.deep.equal(room.toEntry());
        });

        it("should be able to find many rooms", async () => {
            for (let i = 0; i < 20; i++) {
                const room = new BridgedRoom({} as any, {
                    access_scopes: new Set(["fooo", "bar"]),
                    access_token: "access_token_foo",
                    inbound_id: "a_remote_id" + i,
                    matrix_room_id: "a_matrix_id",
                    slack_bot_id: "a_bot_id",
                    slack_bot_token: "a_bot_token",
                    slack_channel_id: "a_channel_id",
                    slack_channel_name: "a_channel_name",
                    slack_team_domain: "a_team_domain",
                    slack_team_id: "a_team_id",
                    slack_user_id: "a_user_id",
                    slack_user_token: "a_user_token",
                    slack_webhook_uri: "a_webhook_uri",
                }, {} as any);
                await ds().upsertRoom(room);
            }
            const rooms = await ds().getAllRooms();
            expect(rooms).to.have.lengthOf(20); // Account for the last test
        });
    });

    describe("teams", () => {
        it("should insert and retrieve a team", async () => {
            await ds().upsertTeam("12345team", "some_bot_token", "a_team_name", "team_user_id");
            const team = await ds().getTeam("12345team");
            expect(team).to.deep.equal({
                team_id: "12345team",
                bot_token: "some_bot_token",
                team_name: "a_team_name",
                user_id: "team_user_id",
            });
        });
    
        it("should insert, upsert and retrieve a team", async () => {
            await ds().upsertTeam("54321team", "some_bot_token", "a_team_name", "team_user_id");
            await ds().upsertTeam("54321team", "another_bot_token", "new_team_name", "foo_user_id");
            const team = await ds().getTeam("54321team");
            expect(team).to.deep.equal({
                team_id: "54321team",
                bot_token: "another_bot_token",
                team_name: "new_team_name",
                user_id: "foo_user_id",
            });
        });
    });
}