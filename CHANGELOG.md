 1.3.0 (2020-05-12)
===================

Features
--------

- Add ability to limit the number of teams and rooms via the config ([\#397](https://github.com/matrix-org/matrix-appservice-slack/issues/397))
- Check if a channel is linked to another room, and unauthorize the link if so. ([\#401](https://github.com/matrix-org/matrix-appservice-slack/issues/401))
- Support automatically bridging to the new room on room upgrade ([\#402](https://github.com/matrix-org/matrix-appservice-slack/issues/402))

Bugfixes
--------

- Allow bridging to private channels via the provisioner ([\#403](https://github.com/matrix-org/matrix-appservice-slack/issues/403))
- Fix postgress configurations failing to start when using the offical docker image. ([\#405](https://github.com/matrix-org/matrix-appservice-slack/issues/405))
- Bridge will no longer update user's displayname with a bots name when a bot is modified ([\#408](https://github.com/matrix-org/matrix-appservice-slack/issues/408))


Internal Changes
----------------

- Fix exception on missing `error` in createTeamClient ([\#404](https://github.com/matrix-org/matrix-appservice-slack/issues/404))


1.2.0 (2020-05-07)
===================

No significant changes.


1.2.0-rc1 (2020-04-17)
=======================

**BREAKING CHANGE** - Note that this release requires requests to /_matrix/provision are authenticated with the `hs_token`.

Features
--------

- Add metrics for active users and rooms ([\#380](https://github.com/matrix-org/matrix-appservice-slack/issues/380))


Bugfixes
--------

- Include server name in the Matrix users regex ([\#368](https://github.com/matrix-org/matrix-appservice-slack/issues/368))
- Fix Slack user updates (e.g. to their Display name) not getting immediately synced with Workspace Sync enabled ([\#377](https://github.com/matrix-org/matrix-appservice-slack/issues/377))
- Fix occasional crash if an error occurs handling a Slack event. ([\#392](https://github.com/matrix-org/matrix-appservice-slack/issues/392))
- **SECURITY FIX** The bridge now requires authentication on the /_matrix/provision set of endpoints. It requires either an `access_token` query parameter or a `Authorization` header containing the `hs_token` provided in the registration file. ([\#395](https://github.com/matrix-org/matrix-appservice-slack/issues/395))


Improved Documentation
----------------------

- Change NPM instructions to use the path config/config.yaml ([\#364](https://github.com/matrix-org/matrix-appservice-slack/issues/364))
- Correct database name in a code example to slack_bridge ([\#365](https://github.com/matrix-org/matrix-appservice-slack/issues/365))
- Minor wording changes in `getting_started.md` ([\#366](https://github.com/matrix-org/matrix-appservice-slack/issues/366))
- Use a descriptive label for a link in README.md ([\#367](https://github.com/matrix-org/matrix-appservice-slack/issues/367))
- Add documentation for Team Sync ([\#372](https://github.com/matrix-org/matrix-appservice-slack/issues/372))


Internal Changes
----------------

- Add decorators to provisioning functions ([\#358](https://github.com/matrix-org/matrix-appservice-slack/issues/358))
- Bump minimist from 1.2.0 to 1.2.2 ([\#362](https://github.com/matrix-org/matrix-appservice-slack/issues/362))
- Correct ISlackEvent.user type; remove unused declarations ([\#374](https://github.com/matrix-org/matrix-appservice-slack/issues/374))
- Enable code linting for no-any where it does matter ([\#375](https://github.com/matrix-org/matrix-appservice-slack/issues/375))
- Fix read the docs and add new page to nav bar ([\#379](https://github.com/matrix-org/matrix-appservice-slack/issues/379))
- Upgrade various low-risk dependencies ([\#381](https://github.com/matrix-org/matrix-appservice-slack/issues/381))
- Upgrade uuid dependency ([\#382](https://github.com/matrix-org/matrix-appservice-slack/issues/382))
- Upgrade quick-lru dependency (requires NodeJS >=10) ([\#383](https://github.com/matrix-org/matrix-appservice-slack/issues/383))
- Add Launch config for VS Code and enable SourceMaps ([\#384](https://github.com/matrix-org/matrix-appservice-slack/issues/384))
- Add error and debug logs to .gitignore ([\#385](https://github.com/matrix-org/matrix-appservice-slack/issues/385))
- Remove chalk as a direct dependency ([\#386](https://github.com/matrix-org/matrix-appservice-slack/issues/386))
- Upgrade dependency pg-promise 10, which requires PostgreSQL 11 ([\#387](https://github.com/matrix-org/matrix-appservice-slack/issues/387))
- Fix PostgreSQL errors when a metric activity is recorded twice ([\#393](https://github.com/matrix-org/matrix-appservice-slack/issues/393))
- Updated dependency `matrix-appservice-bridge` to `1.12.2` ([\#396](https://github.com/matrix-org/matrix-appservice-slack/issues/396))


1.1.0 (2020-02-21)
===================

No significant changes.


1.1.0-rc1 (2020-02-19)
===================

Features
--------

- Add ability to sync Slack channels and users automatically to Matrix ([\#331](https://github.com/matrix-org/matrix-appservice-slack/issues/331))
- Sync Slack membership changes to Matrix ([\#332](https://github.com/matrix-org/matrix-appservice-slack/issues/332))
- Add `whoami` user command. ([\#337](https://github.com/matrix-org/matrix-appservice-slack/issues/337))
- Create private rooms on demand if it doesn't exist ([\#340](https://github.com/matrix-org/matrix-appservice-slack/issues/340))


Bugfixes
--------

- Fix edits from Matrix appearing as fallback text. ([\#324](https://github.com/matrix-org/matrix-appservice-slack/issues/324))
- Fix issue where Slack edits would sometimes not appear as Matrix edits. ([\#325](https://github.com/matrix-org/matrix-appservice-slack/issues/325))
- Fix issue where messages from the bot would be interpreted as commands. ([\#329](https://github.com/matrix-org/matrix-appservice-slack/issues/329))
- Fix matrix replies not showing up on slack ([\#336](https://github.com/matrix-org/matrix-appservice-slack/issues/336))
- Allow webhook/oauth/event requests with prefixes. ([\#339](https://github.com/matrix-org/matrix-appservice-slack/issues/339))
- Fix issue where slack bot actions may fail (such as listing channels). Also increase the number of channels returned when provisioning ([\#355](https://github.com/matrix-org/matrix-appservice-slack/issues/355))


Internal Changes
----------------

- SIGTERM now causes a clean exit ([\#330](https://github.com/matrix-org/matrix-appservice-slack/issues/330))
- Move ghost handing to `SlackGhostStore` ([\#335](https://github.com/matrix-org/matrix-appservice-slack/issues/335))
- New installations should use a "Classic Slack app" rather than a new Slack App for OAuth. More details in README.md ([\#356](https://github.com/matrix-org/matrix-appservice-slack/issues/356))


1.0.2 (2019-11-13)
===================

Features
--------

- Messages bridged to Slack now get links with text-based content unfurled ([\#266](https://github.com/matrix-org/matrix-appservice-slack/issues/266))


Bugfixes
--------

- Fix Markdown link replacements deleting link text, links, and text between links. ([\#299](https://github.com/matrix-org/matrix-appservice-slack/issues/299))
- Fix Matrix images being sent as the filename only on Slack ([\#302](https://github.com/matrix-org/matrix-appservice-slack/issues/302))
- Mentions will now work if followed by a colon and a space ([\#320](https://github.com/matrix-org/matrix-appservice-slack/issues/320))


Improved Documentation
----------------------

- Fix minor typos in documentation that made it inconsistent ([\#306](https://github.com/matrix-org/matrix-appservice-slack/issues/306))
- Fix syntax typo for service start command. ([\#317](https://github.com/matrix-org/matrix-appservice-slack/issues/317))


1.0.1 (2019-10-08)
===================

Features
--------

- You can now specify the appservice port in the config. ([\#295](https://github.com/matrix-org/matrix-appservice-slack/issues/295))


Bugfixes
--------

- Fixes to matrix -> slack message formatting to ensure consistent success. ([\#280](https://github.com/matrix-org/matrix-appservice-slack/issues/280))
- Typescript now builds correctly after a typing change on the upstream node-slack library. Thanks @kampka ([\#288](https://github.com/matrix-org/matrix-appservice-slack/issues/288))
- Fix webhooks not being able to set a displayname and erroneously deduplicating messages. ([\#291](https://github.com/matrix-org/matrix-appservice-slack/issues/291))
- Fix issue where migrating slack users to postgres would fail. ([\#294](https://github.com/matrix-org/matrix-appservice-slack/issues/294))


Internal Changes
----------------

- Fix compile issues related to `Logger` ([\#296](https://github.com/matrix-org/matrix-appservice-slack/issues/296))


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

