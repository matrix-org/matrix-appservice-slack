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

import { Options } from "yargs";

export type ResponseCallback = (response: string) => void;
interface IHandlerArgs {
    matched: (b: true) =>  void;
    completed: (err: Error|null) =>  void;
    respond: ResponseCallback;
    [key: string]: unknown;
}
type CommandCallback = (args: IHandlerArgs) => void|Promise<void>;

export class AdminCommand {
    constructor(
        public readonly command: string | string[],
        public readonly description: string,
        private readonly cb: CommandCallback,
        public readonly options: {[key: string]: Options}|null = null) {
    }

    public async handler(argv: IHandlerArgs) {
        argv.matched(true);
        try {
            await this.cb(argv);
            argv.completed(null);
        } catch (ex) {
            argv.completed(ex);
        }
    }

    public simpleHelp(): string {
        const opts = this.options || {};
        const commandString = Object.keys(opts).sort((a, b) => {
            const x = opts[a].demandOption;
            const y = opts[b].demandOption;
            return (x === y) ? 0 : x ? -1 : 1;
        }).map((key, i) => {
            const opt = opts[key];
            let strOpt = key;
            if (!opt.demandOption) {
                strOpt = `[${strOpt}]`;
            }
            if (this.command.includes(` ${key}`) || this.command.includes(` [${key}]`)) {
                return null;
            }
            // Spacing
            return (i === 0 ? " " : "") + strOpt;
        }).filter((n) => n !== null).join(" ");
        return `${this.command}${commandString} - ${this.description}`;
    }

    public detailedHelp(): string[] {
        const response: string[] = [];
        response.push(`${this.command} - ${this.description}`);
        const opts = this.options || {};
        Object.keys(opts).sort((a, b) => {
            const x = opts[a].demandOption;
            const y = opts[b].demandOption;
            return (x === y) ? 0 : x ? -1 : 1;
        }).forEach((key) => {
            const opt = opts[key];
            const positional = this.command.includes(` ${key}`) || this.command.includes(` [${key}]`);
            const alias = opt.alias && !positional ? `|-${opt.alias}` : "";
            const k = positional ? key : `--${key}`;
            const required = opt.demandOption ? " (Required)" : "";
            response.push(`  ${k}${alias} - ${opt.description}${required}`);
        });
        return response;
    }
}
