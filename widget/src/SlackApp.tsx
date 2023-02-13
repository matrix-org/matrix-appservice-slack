import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useProvisioningContext } from './ProvisioningApp';
import { ProvisioningError } from './ProvisioningClient';
import { GetLinkResponse, SlackChannel, SlackProvisioningClient, SlackWorkspace } from './SlackProvisioningClient';
import * as Text from './components/text';
import * as Buttons from './components/buttons';
import * as Forms from './components/forms';
import * as Alerts from './components/alerts';
import { Card, Rule } from './components/layout';

const authWindowPollIntervalMs = 500;
const authWindowTimeoutMs = 30000;

const WorkspaceItem = ({
    workspace,
    disabled,
    logoutWorkspace,
}:{
    workspace: SlackWorkspace,
    disabled: boolean,
    logoutWorkspace: (workspace: SlackWorkspace) => Promise<void>,
}) => {
    const logout = useCallback(async() => {
        await logoutWorkspace(workspace);
    }, [workspace, logoutWorkspace]);

    return <div className="flex justify-between items-center border border-grey-50 rounded-lg p-4">
        <div>
            <Text.BodySemiBold>{ workspace.name }</Text.BodySemiBold>
            <Text.Micro className="text-grey-200">{ workspace.id }</Text.Micro>
        </div>
        <Buttons.Outline color="danger" size="small" onClick={logout} disabled={disabled}>
            Log out
        </Buttons.Outline>
    </div>;
};

const Workspaces = ({
    client,
    workspaces,
    refreshWorkspaces,
}: {
    client: SlackProvisioningClient,
    workspaces: SlackWorkspace[],
    refreshWorkspaces: () => Promise<void>,
}) => {
    const [error, setError] = useState('');
    const [isBusy, setIsBusy] = useState(false);

    const logoutWorkspace = useCallback(async(workspace: SlackWorkspace) => {
        setIsBusy(true);
        try {
            const result = await client.logout(workspace.id, workspace.slack_id);
            if (!result.deleted) {
                setError(`Could not log out workspace. ${result.msg ?? ''}`);
            }
        } catch (e) {
            console.error('Failed to log out:', e);
            setError(
                'Could not log out workspace.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
        } finally {
            setIsBusy(false);
            await refreshWorkspaces();
        }
    }, [client, refreshWorkspaces]);

    const loginWorkspace = useCallback(async() => {
        setError('');

        let authUrl;
        try {
            authUrl = await client.getAuthUrl();
        } catch (e) {
            console.error('Failed to get auth URL:', e);
            setError(
                'Could not get login URL.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
            return;
        }

        const authWindow = window.open(authUrl, '_blank');
        if (authWindow === null) {
            setError('Please allow popups to authorize with Slack.');
            return;
        }
        setError('Please close the window after authorizing with Slack.');
        await new Promise<void>((resolve) => {
            let elapsedMs = 0;
            const interval = window.setInterval(() => {
                elapsedMs += authWindowPollIntervalMs;
                if (elapsedMs > authWindowTimeoutMs || authWindow.closed) {
                    clearTimeout(interval);
                    setError('');
                    resolve();
                }
            }, authWindowPollIntervalMs);
        });
        // Window closed or waited long enough
        await refreshWorkspaces();
    }, [client, refreshWorkspaces]);

    let content;
    if (workspaces.length > 0) {
        content = workspaces.map(workspace =>
            <WorkspaceItem
                workspace={workspace}
                disabled={isBusy}
                logoutWorkspace={logoutWorkspace}
                key={workspace.id}
            />
        );
    } else {
        content = <Text.Caption className="text-grey-200">No workspaces have been added yet.</Text.Caption>;
    }

    return <Card>
        <Text.SubtitleSemiBold>Workspaces</Text.SubtitleSemiBold>
        <Rule/>
        <div className="grid gap-4">
            { content }
            <div className="col-span-full grid md:grid-cols-2 gap-4 mt-4">
                <Text.Caption>Add workspaces by authorizing with Slack.</Text.Caption>
                <div className="flex justify-end">
                    <a href="#" className="slack-button" onClick={loginWorkspace}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122.8 122.8"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"></path><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"></path><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"></path><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"></path></svg>
                        Add to Slack
                    </a>
                </div>
            </div>
            <div className="col-span-full">
                { error && <Alerts.Warning><Text.Caption>{ error }</Text.Caption></Alerts.Warning> }
            </div>
        </div>
    </Card>;
};

const LinkForm = ({
    client,
    roomId,
    workspaces,
    onLinked,
}:{
    client: SlackProvisioningClient,
    roomId: string,
    workspaces: SlackWorkspace[],
    onLinked: () => Promise<void>,
}) => {
    const [error, setError] = useState('');
    const [channels, setChannels] = useState<SlackChannel[]>();

    const [workspaceId, setWorkspaceId] = useState('');
    const [channelId, setChannelId] = useState('');

    const isFormValid = workspaceId && channelId;

    // Reset the whole form when workspaces change
    useEffect(() => {
        setError('');
        setChannels(undefined);
        setWorkspaceId('');
        setChannelId('');
    }, [workspaces]);

    const [isBusyListChannels, setIsBusyListChannels] = useState(false);
    // List channels when the selected workspace changes
    useEffect(() => {
        const listChannels = async() => {
            setError('');
            setChannels(undefined);
            setChannelId('');

            if (!workspaceId) {
                return;
            }
            setIsBusyListChannels(true);
            try {
                const channels = await client.listChannels(workspaceId);
                setChannels(channels);
            } catch (e) {
                console.error('Failed to list channels:', e);
                setError(
                    'Could not get channels for this workspace.'
                    + ` ${e instanceof ProvisioningError ? e.message : ''}`
                );
            } finally {
                setIsBusyListChannels(false);
            }
        };
        void listChannels();
    }, [client, workspaceId]);


    const [isBusyLinkChannel, setIsBusyLinkChannel] = useState(false);
    const linkChannel = useCallback(async() => {
        setError('');
        setIsBusyLinkChannel(true);
        try {
            await client.link(roomId, workspaceId, channelId);
            await onLinked();
        } catch (e) {
            console.error('Failed to link channel:', e);
            setError(
                'Could not link channel.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
        } finally {
            setIsBusyLinkChannel(false);
        }
    }, [client, roomId, channelId, workspaceId, onLinked]);

    const onWorkspaceIdChange: React.ChangeEventHandler<HTMLSelectElement> = useCallback(async(e) => {
        setWorkspaceId(e.currentTarget.value);
    }, []);

    const onChannelIdChange: React.ChangeEventHandler<HTMLSelectElement> = useCallback((e) => {
        setChannelId(e.currentTarget.value);
    }, []);

    return <Card>
        <Text.SubtitleSemiBold>Link a channel</Text.SubtitleSemiBold>
        <Rule/>
        <div className="grid md:grid-cols-2 gap-4">
            <Forms.Select
                label="Workspace"
                value={workspaceId}
                disabled={isBusyLinkChannel}
                onChange={onWorkspaceIdChange}
            >
                <option value="" key="blank">Select a workspace</option>
                { workspaces.map(workspace =>
                    <option value={workspace.id} key={workspace.id}>{ `${workspace.name} (${workspace.id})` }</option>
                ) }
            </Forms.Select>
            <Forms.Select
                label="Channel"
                comment={isBusyListChannels ? 'Loading channels...' : ''}
                value={channelId}
                disabled={!workspaceId || isBusyListChannels || isBusyLinkChannel}
                onChange={onChannelIdChange}
            >
                <option value="" key="blank">Select a channel</option>
                { channels && channels?.map(channel =>
                    <option value={channel.id} key={channel.id}>{ `#${channel.name}` }</option>
                ) }
            </Forms.Select>
            <div className="col-span-full flex justify-end">
                <Buttons.Solid onClick={linkChannel} disabled={!isFormValid || isBusyLinkChannel}>
                    Link
                </Buttons.Solid>
            </div>
            <div className="col-span-full">
                { error && <Alerts.Warning><Text.Caption>{ error }</Text.Caption></Alerts.Warning> }
            </div>
        </div>
    </Card>;
};

const Unlinked = ({
    client,
    roomId,
    onLinked,
}:{
    client: SlackProvisioningClient,
    roomId: string,
    onLinked: () => Promise<void>,
}) => {
    const [error, setError] = useState('');
    const [workspaces, setWorkspaces] = useState<SlackWorkspace[]>();

    const listWorkspaces = useCallback(async() => {
        try {
            const workspaces = await client.listWorkspaces();
            // TODO Disambiguate any workspaces with the same name by appending their ID
            setWorkspaces(workspaces);
        } catch (e) {
            console.error('Failed to list workspaces:', e);
            setError(
                'Could not get workspaces.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
        }
    }, [client]);

    useEffect(() => {
        void listWorkspaces();
    }, [listWorkspaces]);

    let content;
    if (workspaces) {
        content = <>
            <Workspaces
                client={client}
                workspaces={workspaces}
                refreshWorkspaces={listWorkspaces}
            />
            <LinkForm
                client={client}
                workspaces={workspaces}
                roomId={roomId}
                onLinked={onLinked}
            />
        </>;
    } else if (error) {
        content = <Alerts.Warning><Text.Caption>{ error }</Text.Caption></Alerts.Warning>
    } else {
        content = <Text.Caption className="text-grey-200">Loading...</Text.Caption>;
    }

    return content;
};

const Linked = ({
    client,
    link,
    onUnlinked,
}: {
    client: SlackProvisioningClient,
    link: GetLinkResponse,
    onUnlinked: () => Promise<void>,
}) => {
    const [error, setError] = useState('');

    const unlinkChannel = useCallback(async() => {
        try {
            await client.unlink(link.matrix_room_id);
            await onUnlinked();
        } catch (e) {
            console.error('Failed to unlink channel:', e);
            setError(
                'Could not unlink channel.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
        }
    }, [client, link, onUnlinked]);

    const channelName = ('#' + link.slack_channel_name) || link.slack_channel_id || link.slack_webhook_uri || 'Unknown Channel';
    return <Card>
        <Text.SubtitleSemiBold>Linked</Text.SubtitleSemiBold>
        <Rule/>
        <div className="grid gap-4">
            <Text.Body>
                This room is linked to <span className="font-semibold">{channelName}</span>.
            </Text.Body>
            <Text.Caption className="text-grey-200">
                Make sure you invite the bot to this Slack channel: <span className="font-semibold">/invite @element_bridge</span>
            </Text.Caption>
            <div className="flex justify-end">
                <Buttons.Outline color="danger" onClick={unlinkChannel}>
                    Unlink
                </Buttons.Outline>
            </div>
            { error && <Alerts.Warning><Text.Caption>{ error }</Text.Caption></Alerts.Warning> }
        </div>
    </Card>;
};

export const SlackApp = () => {
    const provisioningContext = useProvisioningContext();

    const client = useMemo(
        () => new SlackProvisioningClient(provisioningContext.client),
        [provisioningContext.client],
    );

    const [error, setError] = useState('');
    const [link, setLink] = useState<GetLinkResponse | null>();

    const getLink = useCallback(async() => {
        try {
            const link = await client.getLink(provisioningContext.roomId);
            setLink(link ?? null);
        } catch (e) {
            console.error('Failed to get link:', e);
            setError(
                'Could not get link status.'
                + ` ${e instanceof ProvisioningError ? e.message : ''}`
            );
        }
    }, [client, provisioningContext]);

    useEffect(() => {
        void getLink();
    }, [getLink]);

    let content;
    if (link !== undefined) {
        if (link) {
            content =
                <Linked
                    client={client}
                    link={link}
                    onUnlinked={getLink}
                />;
        } else {
            content =
                <Unlinked
                    client={client}
                    roomId={provisioningContext.roomId}
                    onLinked={getLink}
                />;
        }
    } else if (error) {
        content =
            <Alerts.Warning>
                <Text.Caption>{ error }</Text.Caption>
            </Alerts.Warning>;
    } else {
        content = <Text.Caption className="text-grey-200">Loading...</Text.Caption>;
    }

    return <div className="flex flex-col gap-4">
        { content }
    </div>;
};
