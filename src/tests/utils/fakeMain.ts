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

export class FakeMain {
    public readonly timerFinished: {[eventName: string]: string } = {};

    public clientFactory: FakeClientFactory = new FakeClientFactory();

    public startTimer(eventName: string) {
        this.timerFinished[eventName] = "notfinished";
        return (reason: {outcome: string}) => {
            this.timerFinished[eventName] = reason.outcome;
        };
    }
}

class FakeClientFactory {
    public async getClientForUser(teamId: string, matrixId: string) {
        return {};
    }
}
