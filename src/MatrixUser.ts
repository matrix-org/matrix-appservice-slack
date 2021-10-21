import QuickLRU from "@alloc/quick-lru";
import { StateLookupEvent, UserProfile } from "matrix-appservice-bridge";
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

import { Main } from "./Main";

/**
 * A Matrix event `m.room.member` indicating a user's presence in a room.
 */
interface IMatrixMemberEvent {
    content?: UserProfile;
}

const CACHED_PROFILE_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const CACHED_PROFILE_MAX_SIZE = 10_000;

const ROOM_PROFILE_CACHE = new QuickLRU<string, {
    profile: UserProfile,
    ts: number,
}>({ maxSize: CACHED_PROFILE_MAX_SIZE });

/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user.
 */
export class MatrixUser {
    public readonly userId: string;
    private atime: number|null;
    constructor(
        private main: Main,
        opts: {user_id: string},
        private profileCache = ROOM_PROFILE_CACHE,
    ) {
        this.userId = opts.user_id;
        this.atime = null;
    }

    /**
     * Returns a suitable displayname to identify the user within the given room,
     * taking into account disambiguation with other users in the same room.
     * @param roomId The roomId to calculate the user's displayname for.
     */
    public async getDisplaynameForRoom(roomId: string): Promise<string> {
        const profile = await this.getProfileForRoom(roomId);
        if (!profile?.displayname) {
            return this.userId;
        }

        const displayname = profile.displayname;

        // Is this name used more than once in this room?
        const memberEvents = this.main.getStoredEvent(roomId, "m.room.member") as StateLookupEvent[];
        const matches: string[] = memberEvents.filter(
            (ev) => ev.content && (ev as IMatrixMemberEvent).content?.displayname === displayname,
        ).map((ev) => ev.state_key);

        // Disambiguate, if the display name is used more than once.
        return (matches.length > 1) ? `${displayname} (${this.userId})` : displayname;
    }

    public async getAvatarUrlForRoom(roomId: string): Promise<string|undefined> {
        const profile = await this.getProfileForRoom(roomId);
        return profile?.avatar_url;
    }

    private async getProfileForRoom(roomId: string): Promise<UserProfile|undefined> {
        const myMemberEvent = (this.main.getStoredEvent(
            roomId, "m.room.member", this.userId,
        ) as StateLookupEvent) as IMatrixMemberEvent;
        let profile: UserProfile|undefined = myMemberEvent?.content;

        if (!profile) {
            const cacheKey = `${roomId}:${this.userId}`;
            const cached = this.profileCache.get(cacheKey);
            if (cached && cached.ts + CACHED_PROFILE_MAX_AGE > Date.now()) {
                profile = cached.profile;
            } else {
                profile = await this.main.getUserProfile(this.userId);
                if (profile) {
                    this.profileCache.set(cacheKey, { profile, ts: Date.now() });
                }
            }
        }

        return profile;
    }

    public get aTime(): number|null {
        return this.atime;
    }

    public bumpATime(): void {
        this.atime = Date.now() / 1000;
    }
}
