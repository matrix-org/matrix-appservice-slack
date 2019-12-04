export interface BuildBridgeStateEventOpts {
    workspaceId: string;
    workspaceName: string;
    workspaceUrl: string;
    workspaceLogo?: string;
    channelId: string;
    channelName?: string;
    channelUrl: string;
    creator?: string;
    isActive: boolean;
}

export function getBridgeStateKey(workspaceId: string, channelId: string) {
    return `org.matrix.matrix-appservice-slack://slack/${workspaceId}/${channelId}`;
}

export const BridgeStateType = "uk.half-shot.bridge";

export function buildBridgeStateEvent(opts: BuildBridgeStateEventOpts) {
    // See https://github.com/matrix-org/matrix-doc/blob/hs/msc-bridge-inf/proposals/2346-bridge-info-state-event.md
    return {
        type: BridgeStateType,
        content: {
            ...(opts.creator ? {creator: opts.creator } : {}),
            status: opts.isActive ? "active" : "inactive",
            protocol: {
                id: "slack",
                displayname: "Slack",
            },
            network: {
                id: opts.workspaceId,
                displayname: opts.workspaceName,
                external_url: opts.workspaceUrl,
                ...(opts.workspaceLogo ? {avatar: opts.workspaceLogo } : {}),
            },
            channel: {
                id: opts.channelId,
                displayname: opts.channelName,
                external_url: opts.channelUrl,
            },
        },
    };
}
