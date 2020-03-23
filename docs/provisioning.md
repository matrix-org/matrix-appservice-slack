# Provisioning

The Slack bridge implements a HTTP API that can be used to provision channels into rooms
and manage user accounts, including features like puppeting.

## Auth callbacks

The bridge supports "auth callbacks". This means the bridge can call out to an
external service to verify if a given entity is allowed to bridge. This is useful
if you are developing a paid service.