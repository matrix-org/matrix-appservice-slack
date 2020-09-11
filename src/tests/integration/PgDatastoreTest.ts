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
import { Logging } from "matrix-appservice-bridge";
import * as pgInit from "pg-promise";
import { PgDatastore } from "../../datastore/postgres/PgDatastore";
import { expect } from "chai";
import { doDatastoreTests } from "./SharedDatastoreTests";
const log = Logging.get("PgDatastoreTest");

const enableTest = process.env.SLACKBRIDGE_TEST_ENABLEPG === "yes";
const describeFnl = enableTest ? describe : describe.skip;

const DATABASE = process.env.SLACKBRIDGE_TEST_PGDB || "slackintegtest";
const POSTGRES_URL = process.env.SLACKBRIDGE_TEST_PGURL || `postgresql://postgres:pass@localhost`;
const POSTGRES_URL_DB = `${POSTGRES_URL}/${DATABASE}`;

const pgp = pgInit();
describeFnl("PgDatastore", () => {
    // tslint:disable-next-line: no-any
    let superDb: pgInit.IDatabase<any>;
    let ds: PgDatastore;
    before(async () => {
        Logging.configure({console: "info"});
        superDb = pgp(POSTGRES_URL + "/postgres");
        ds = new PgDatastore(POSTGRES_URL_DB);
        try {
            await superDb.none(`DROP DATABASE ${DATABASE}`);
        } catch (ex) {
            log.warn("Failed to drop database");
        }
        try {
            await superDb.none(`CREATE DATABASE ${DATABASE}`);
        } catch (ex) {
            log.warn("Failed to create database");
            throw ex;
        }
    });

    it("should be able to exec the current schema set successfully", async () => {
        await ds.ensureSchema();
        const { version } = (await ds.postgresDb.one(`SELECT version FROM schema`));
        expect(version).to.equal(PgDatastore.LATEST_SCHEMA);
    });

    doDatastoreTests(() => ds, async () => {
        await ds.postgresDb.none("DELETE FROM reactions");
        await ds.postgresDb.none("DELETE FROM rooms");
    });

    after(async () => {
        Logging.configure({console: "silent"});
    });
});
