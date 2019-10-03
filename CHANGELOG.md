1.0.0 (2019-10-03)
===================

This release marks the end of the 1.0RC period. Please see [UPGRADE](UPGRADE.md)
for notes on how to upgrade your bridge from 0.3.2 to 1.0.

Features
--------

- Add documentation built by RTD at https://matrix-appservice-slack.rtfd.io ([\#273](https://github.com/matrix-org/matrix-appservice-slack/issues/273))

Bugfixes
--------

- Fix migrator bug where it would not find an access token ([\#267](https://github.com/matrix-org/matrix-appservice-slack/issues/267))
- Fix issue where Slack webhooks would not be able to send messages to Matrix. ([\#269](https://github.com/matrix-org/matrix-appservice-slack/issues/269))
- Fix issue where uploading large files will crash the bridge. ([\#264](https://github.com/matrix-org/matrix-appservice-slack/issues/264))
- Lock around avatar updates so it doesn't race. ([\#274](https://github.com/matrix-org/matrix-appservice-slack/issues/274))

Improved Documentation
----------------------

- Update documentation for the bridge to include more information on Docker. Thanks @kingoftheconnors. ([\#168](https://github.com/matrix-org/matrix-appservice-slack/issues/168))
- Added migration instructions for docker users ([\#268](https://github.com/matrix-org/matrix-appservice-slack/issues/268))

1.0.0-rc6 (2019-09-27)
=======================

Bugfixes
--------

- Do not handle slack tombstone messages as edits ([\#262](https://github.com/matrix-org/matrix-appservice-slack/issues/262))
- Fix issue where metrics would not report user activity ages ([\#263](https://github.com/matrix-org/matrix-appservice-slack/issues/263))


1.0.0-rc5 (2019-09-25)
=======================

Bugfixes
--------

- Fix bug where teams would start echoing messages after accepting an oauth request. ([\#260](https://github.com/matrix-org/matrix-appservice-slack/issues/260))
- Fix issue where using RTM on large deployments would trigger Slack to turn off Event subscriptions ([\#261](https://github.com/matrix-org/matrix-appservice-slack/issues/261))


1.0.0-rc4 (2019-09-24)
=======================

Bugfixes
--------

- Fix multi-person DMs being marked with the group (private channel) type rather than the mpim type. ([\#253](https://github.com/matrix-org/matrix-appservice-slack/issues/253))
- Connecting an account via OAuth will no longer barf on the lack of a `puppeting` parameter ([\#254](https://github.com/matrix-org/matrix-appservice-slack/issues/254))
- Don't log stack traces for missing rooms, teams or events ([\#255](https://github.com/matrix-org/matrix-appservice-slack/issues/255))
- Don't log the whole response object when an error occurs when sending slack requests ([\#256](https://github.com/matrix-org/matrix-appservice-slack/issues/256))
- Fix .toUpperCase() errors due to the bridge trying to handle unknown deleted messages ([\#257](https://github.com/matrix-org/matrix-appservice-slack/issues/257))


Internal Changes
----------------

- Update datastore.md with a few more options ([\#239](https://github.com/matrix-org/matrix-appservice-slack/issues/239))
- Fix issue where towncrier would wrongly link to matrix-appservice-slack-issues ([\#251](https://github.com/matrix-org/matrix-appservice-slack/issues/251))
- Towncrier should check against develop for changelog changes ([\#258](https://github.com/matrix-org/matrix-appservice-slack/issues/258))


1.0.0-rc3 (2019-09-24)
=======================

Bugfixes
--------

- Ensure users enter the correct type of token into the link command ([\#243](https://github.com/matrix-org/matrix-appservice-slack/issues/243))
- Fix issue where the bridge will not start if a team cannot connect to RTM. ([\#247](https://github.com/matrix-org/matrix-appservice-slack/issues/247))


Internal Changes
----------------

- Log more information during startup ([\#246](https://github.com/matrix-org/matrix-appservice-slack/issues/246))


1.0.0-rc2 (2019-09-18)
=======================

Features
--------

- Suppport puppeted reactions/redactions ([\#235](https://github.com/matrix-org/matrix-appservice-slack/issues/235))


Bugfixes
--------

- Remove option slack_user_token on link command ([\#236](https://github.com/matrix-org/matrix-appservice-slack/issues/236))
- Messages from puppeted accounts are no longer duplicated over the bridge ([\#237](https://github.com/matrix-org/matrix-appservice-slack/issues/237))
- Do not send messages to slack with no content ([\#238](https://github.com/matrix-org/matrix-appservice-slack/issues/238))


1.0.0-rc1 (2019-09-13)
=======================

**This is the first RC of a major restructure of the bridge's architecture. Please do NOT upgrade production bridges onto this release**

Features
--------

- Add caching option to config to limit the number of stored users in memory ([\#228](https://github.com/matrix-org/matrix-appservice-slack/issues/228))
- The bridge now has support for the RTM API. See the README for more information. ([\#164](https://github.com/matrix-org/matrix-appservice-slack/issues/164))
- Support Postgresql and implement generic Datastores. ([\#186](https://github.com/matrix-org/matrix-appservice-slack/issues/186))
- A datastore migration script is included. ([\#190](https://github.com/matrix-org/matrix-appservice-slack/issues/190))
- Add a /health endpoint. ([\#199](https://github.com/matrix-org/matrix-appservice-slack/issues/199))
- Add support for puppeting Slack accounts. ([\#200](https://github.com/matrix-org/matrix-appservice-slack/issues/200))

Bugfixes
--------

- Fix issue where DMs can race while the DM room is being created. ([\#219](https://github.com/matrix-org/matrix-appservice-slack/issues/219))
- Logging out your personal puppeting token no longer logs out the whole workspace. ([\#220](https://github.com/matrix-org/matrix-appservice-slack/issues/220))
- Correctly add reply fallbacks on messages in threads, and edits in threads. Thanks @Cadair. ([\#169](https://github.com/matrix-org/matrix-appservice-slack/pull/169)
- Correctly bookeep threads when we reply on matrix. Thanks @Cadair. ([\#194](https://github.com/matrix-org/matrix-appservice-slack/pull/194)

Internal Changes
----------------

- The project now uses TypeScript for source code ([\#152](https://github.com/matrix-org/matrix-appservice-slack/issues/152))
- The project now has integration testing! ([\#181](https://github.com/matrix-org/matrix-appservice-slack/pull/181))
- The project now uses towncrier for changelog management. ([\#216](https://github.com/matrix-org/matrix-appservice-slack/issues/216))
- Room storage is now handled in a dedicated class ([\#225](https://github.com/matrix-org/matrix-appservice-slack/issues/225))
- We now use the Slack Node library for calls ([\#185](https://github.com/matrix-org/matrix-appservice-slack/issues/185))
- Add CONTRIBUTING.md ([\#207](https://github.com/matrix-org/matrix-appservice-slack/issues/207))

Changes in 0.3.2 (2019-07-22)
=============================

Bugfixes:
- `this.main` should have just been `main`

Changes in 0.3.1 (2019-07-22)
=============================

Bugfixes:
- Fixed issue where invalid slack ghost ids were being used for pills #167.
- Correctly add reply fallbacks on messages in threads, and edits in threads #169. Thanks @Cadair!
- Fix an issue where webhooks would fail to bridge across messages #165.

Changes in 0.3.0 (2019-07-19)
=============================

No changes since 0.3.0-rc3

Changes in 0.3.0-rc3 (2019-07-12)
=============================
Bugfixes:
- Fix slack -> matrix emote messages
- Stop logging bodies

Changes in 0.3.0-rc2 (2019-07-11)
=============================
Bugfixes:
- Remove call to onSlackReactionRemoved (as it's not used)
- teams.db path should use dbdir #156. Thanks @vrutkovs


Changes in 0.3.0-rc1 (2019-07-05)
=============================

Features:

Special shoutout to @Cadair for this release, who dedicated a lot of his time to these features.

- Implement message deletion #129.
- Add support for edits #130.
- Add support for reactions #131.
- Add support for threading (using replies) #132.
- Support displayname and avatar lookups for Slack bots #141
- Replace channel mentions with canonical aliases for bridged rooms #146.
- Support slack attachments #126 #147. Thanks @umitalp for the inital groundwork and @Cadair for the cleanup.

Bugfixes:

- Fix the discrepancy between nicks and names in pills and mentions #111. Thanks @Cadair!
- Fix an issue where slack thumbnails were always assumed to be JPEGs #123. Thanks @Berulacks

Misc:

- Update README to include instructions on authentication setup #140. Thanks @ineiti.
- Remove duplication of registration path and tidy example config #143. Thanks @Cadair.
- Add a dockerfile #145. Thanks @Cadair.


Changes in 0.2.0 (2018-10-24)
=============================

No changes since rc3

Changes in 0.2.0-rc3 (2018-10-23)
=============================
Bugfixes:
- Fix S->M mentions being accidentally escaped. #109 Thanks @Cadair!

Changes in 0.2.0-rc2 (2018-10-20)
=============================

Bugfixes:
- Users can now log out from their slack account.
- The emoji key name is now sent if the text could not be replaced. 

Changes in 0.2.0-rc1 (2018-10-18)
=============================

NOTE: This is the first release of the Slack bridge. 0.1.0 has been the version number
for previous efforts but was never an official release. The list below is all the changes
merged onto the `develop` branch.

Features:

- Support for the Slack Bot API to allow users to bridge their communities with more features than
  using webhooks! #89. Thanks to @perissology for doing the legwork there.
- More provisioning APIs to support the new Bot API bridging methods. #101
- Support triple backtick code syntax #85
- Add support for winston logging through the new bridge component #94
- Allow specifying a dbdir for custom locations of stores #95. Thanks @Cadair!
- Convert Riot Pills to Slack mentions #96. Thanks @Cadair!
- Add support for conversion of snippets to code messages in Matrix #97. Thanks @Cadair!
- Add support for "gitter bridge" style edit messages #98. Thanks @Cadair!
- Implement bridging of Matrix mentions to Slack #99. Thanks @Cadair!

Bugfixes:

- Fallback to userstore for making user pills if the Slack API fails to find a user #84
- Fixed file uploads so they work again #91. Thanks @Cadair!
- Fixed emoji not being substituted on the Matrix side #103.

Misc:

- The bridge now uses matrix-appservice-bridge 1.7.0

