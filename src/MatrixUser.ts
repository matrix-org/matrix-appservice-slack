/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user.
 */
export class MatrixUser {
    public readonly userId: string;
    private atime: number|null;
    constructor(private main: any, opts: {user_id: string}) {
        this.userId = opts.user_id;
        this.atime = null;
    }

    /**
     * Returns a suitable displayname to identify the user within the given room,
     * taking into account disambiguation with other users in the same room.
     * @param roomId The roomId to calculate the user's displayname for.
     */
    public getDisplaynameForRoom(roomId: string) {
        const myMemberEvent = this.main.getStoredEvent(
            roomId, "m.room.member", this.userId
        );

        let displayname: string|null = null;

        if (myMemberEvent && myMemberEvent.content && myMemberEvent.content.displayname) {
            displayname = myMemberEvent.content.displayname;
        } else {
            return this.userId;
        }

        // To work out what displayname we can show requires us to work out if
        // the displayname is unique among them all. Which means we need to find
        // them all

        const memberEvents = this.main.getStoredEvent(
            roomId, "m.room.member"
        );

        const matching: string[] = memberEvents.filter(
            (ev: any) => ev.content && ev.content.displayname === displayname
        );

        if (matching.length > 1) {
            // Disambiguate
            return `${displayname} (${this.userId})`;
        }

        return displayname;
    }

    public getAvatarUrlForRoom(roomId: string) {
        const myMemberEvent = this.main.getStoredEvent(
            roomId, "m.room.member", this.userId
        );

        if (myMemberEvent && myMemberEvent.content && myMemberEvent.content.avatar_url) {
            return myMemberEvent.content.avatar_url;
        } else {
            return null;
        }
    }

    public get aTime() {
        return this.atime;
    }

    public bumpATime() {
        this.atime = Date.now() / 1000;
    }
}
