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

