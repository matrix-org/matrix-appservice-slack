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

// tslint:disable: no-unused-expression

import { MatrixUser } from "../../MatrixUser";
import { Main } from "../../Main";
import { expect } from "chai";

/**
 * Given an array of users, this function mocks `Main.getStoredEvent()` by
 * returning join events for these users.
 */
const getStoredEventGenerator = (users: {
    id?: string,
    displayName?: string,
    avatarUrl?: string,
}[]) => {
    const events = users.map((user) => ({
        type: "m.room.member",
        user_id: user.id,
        content: {
            avatar_url: user.avatarUrl,
            displayname: user.displayName,
            membership: "join",
        }
    }));
    return (roomId: string, eventType: string, stateKey?: string) => {
        // We were asked for one specifc user id
        if (stateKey) {
            return events.find((user) => user.user_id === stateKey);
        }
        // Return an array of all join events
        return events;
    };
};

describe("MatrixUser", () => {
    it("can construct", () => {
        const user = new MatrixUser({} as Main, { user_id: "@alice:localhost"});
        expect(user.userId).to.equal("@alice:localhost");
        expect(user.aTime).to.be.null;
    });

    describe("bumpATime", () => {
        it("will bump to the correct value", () => {
            const user = new MatrixUser({} as Main, { user_id: "@alice:localhost"});
            const now = Date.now() / 1000;
            user.bumpATime();
            // Can either be now, or now + 1
            expect(user.aTime).to.be.greaterThan(now - 1).and.lessThan(now + 2);
        });
    });

    describe("getDisplayName", () => {
        it("returns the user_id when no displayName is given", () => {
            const getStoredEvent = getStoredEventGenerator([]);
            const user = new MatrixUser({ getStoredEvent } as Main, { user_id: "@alice:localhost" });
            expect(user.getDisplaynameForRoom("")).to.equal("@alice:localhost");
        });
        it("returns the displayName if one is given", () => {
            const getStoredEvent = getStoredEventGenerator([
                { id: "@alice:localhost", displayName: "Alice" },
                { displayName: "Hatmaker" },
            ]);
            const user = new MatrixUser({ getStoredEvent } as Main, { user_id: "@alice:localhost" });
            expect(user.getDisplaynameForRoom("")).to.equal("Alice");
        });
        it("returns 'displayName (userId)' if the display name isn't unique", () => {
            const getStoredEvent = getStoredEventGenerator([
                { displayName: "Alice" },
                { id: "@alice:localhost", displayName: "Alice" },
            ]);
            const user = new MatrixUser({ getStoredEvent } as Main, { user_id: "@alice:localhost" });
            expect(user.getDisplaynameForRoom("")).to.equal("Alice (@alice:localhost)");
        });
    });

    describe("getAvatarUrlForRoom", () => {
        it("returns undefined when no avatar is given", () => {
            const getStoredEvent = getStoredEventGenerator([]);
            const user = new MatrixUser({ getStoredEvent } as Main, { user_id: "@alice:localhost" });
            expect(user.getAvatarUrlForRoom("")).to.be.null;
        });
        it("returns the avatar_url if one is given", () => {
            const getStoredEvent = getStoredEventGenerator([
                { id: "@alice:localhost", avatarUrl: "https://localhost/alice.png" },
                { id: "@hatmaker:localhost" },
            ]);
            const user = new MatrixUser({ getStoredEvent } as Main, { user_id: "@alice:localhost" });
            expect(user.getAvatarUrlForRoom("")).to.equal("https://localhost/alice.png");
        });
    });
});
