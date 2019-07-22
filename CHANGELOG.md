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

