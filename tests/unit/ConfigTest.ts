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
import { ConfigValidator } from "matrix-appservice-bridge";
import * as yaml from "js-yaml";
import { promises as fs } from "fs";
import * as path from "path";

const SCHEMA_PATH = path.resolve(__dirname, "../../config/slack-config-schema.yaml");
const SAMPLE_CONFIG_PATH = path.resolve(__dirname, "../../config/config.sample.yaml");
const SAMPLE_COMPLETE_CONFIG_PATH = path.resolve(__dirname, "../../config/config.sample-complete.yaml");

describe("Config", () => {
    let validator: ConfigValidator;
    before(async () => {
        validator = new ConfigValidator(yaml.load(await fs.readFile(SCHEMA_PATH, "utf-8")));
    });

    it("should pass the sample config", async () => {
        const config = yaml.load(await fs.readFile(SAMPLE_CONFIG_PATH, "utf-8"))
        try {
            validator.validate(config);
        } catch (ex: any) {
            if (ex._validationErrors) {
                throw new Error(`Failed to validate:\n` + ex._validationErrors.map((err) => `      '${err.field}' ${err.message}'`).join("\n"))
            }
            throw ex;
        }
    });

    it("should pass the complete sample config", async () => {
        const config = yaml.load(await fs.readFile(SAMPLE_COMPLETE_CONFIG_PATH, "utf-8"))
        try {
            validator.validate(config);
        } catch (ex: any) {
            if (ex._validationErrors) {
                throw new Error(`Failed to validate:\n` + ex._validationErrors.map((err) => `      '${err.field}' ${err.message}'`).join("\n"))
            }
            throw ex;
        }
    });
});
