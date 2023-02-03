/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import { Intent } from "matrix-appservice-bridge";
import { MatrixProfileInfo } from "matrix-bot-sdk";

export const createDM = async (
    senderIntent: Intent, recipients: string|string[], profile?: MatrixProfileInfo, encrypted = false
): Promise<string> => {
    if (!Array.isArray(recipients)) {
        recipients = [recipients];
    }
    const extraContent: Record<string, unknown>[] = [];
    if (encrypted) {
        extraContent.push(
            {
                type: "m.room.encryption",
                state_key: "",
                content: {
                    algorithm: "m.megolm.v1.aes-sha2",
                }
            }
        );
    }
    if (profile?.avatar_url) {
        extraContent.push(
            {
                type: "m.room.avatar",
                state_key: "",
                content: {
                    url: profile.avatar_url,
                }
            }
        );
    }
    const { room_id } = await senderIntent.createRoom({
        createAsClient: true,
        options: {
            invite: recipients,
            preset: "private_chat",
            is_direct: true,
            name: profile?.displayname,
            initial_state: extraContent,
        },
    });
    return room_id;
};
