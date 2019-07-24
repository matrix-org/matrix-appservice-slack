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
