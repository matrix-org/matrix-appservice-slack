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

import { MatrixUser } from "../MatrixUser";
import { Main } from "../Main";
import { expect } from "chai";

describe("MatrixUser", () => {
    it("can construct", () => {
        const user = new MatrixUser({} as Main, { user_id: "hello"});
        expect(user.userId).to.equal("hello");
        expect(user.aTime).to.be.null;
    });

    describe("bumpATime", () => {
        it("will bump to the correct value", () => {
            const user = new MatrixUser({} as Main, { user_id: "hello"});
            const now = Date.now() / 1000;
            user.bumpATime();
            // Can either be now, or now + 1
            expect(user.aTime).to.be.greaterThan(now - 1).and.lessThan(now + 2);
        });
    });
});
