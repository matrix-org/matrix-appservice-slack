# Version specific upgrade nodes

Please see these notes for details on how to upgrade your version
of matrix-appservice-slack to the next version. If you are upgrading a very
old bridge to a very new release, ensure that you follow the steps in order
rather than jumping to the latest.

## 0.3.x > 1.0

This release makes several important changes to the bridge:

1.0 deprecates (but does not remove) support for NeDB. NeDB was the
default and only option for persistent datastores for the bridge until 1.0.
Admins should migrate to using PostgreSQL as soon as possible. Details on how
to do this can be found in [datastores.md](docs/datastores.md).

RTM mode has been added to the bridge. This mode allows you to have rooms
bridged without having to run an internet facing slack bridge. This change will
automatically work for any bridges which have RTM enabled in the config, and
have rooms which have been bridged via the Events API method. Events API based
bridges will continue to work, and the two modes can be used in conjunction.

The bridge will no longer accept "user tokens". User tokens were previously used
by **webhook** linked rooms to support media files. This functionality will no longer
work and these rooms should be upgraded to use the Events API, which supports media
bridging. This can be done the same was as you'd add an Events API link to a fresh room, as the
operation will remove the webhook association.
