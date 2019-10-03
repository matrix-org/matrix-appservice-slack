Features
========

The list below is a mostly exhuastive list of features that
the bridge supports.

- Bridging Slack Channels
    - [x] Public
    - [x] Private
    - [x] IM (puppeting)
- Administration
    - [x] Provisioning API
    - [x] Admin Room
    - [ ] User Admin Rooms
- [x] Metrics - via prometheus
- Direct Messaging (puppeting) [1]
    - [x] Matrix -> Slack
    - [x] Slack -> Matrix
- Content bridging (in both directions)
    - [x] Text (m.text)
    - [x] Formatted Text (m.text html)
    - [x] Audio/Video (m.audio/m.video)
    - [x] Files (m.file)
- Redactions
    - [x] Matrix -> Slack
    - [x] Slack -> Matrix
- Reactions
    - [x] Matrix -> Slack [2]
    - [x] Slack -> Matrix [3]
- Edits
    - [x] Matrix -> Slack
    - [x] Slack -> Matrix
- Threading
    - [x] Matrix -> Slack
    - [x] Slack -> Matrix
- Membership Syncing
    - [ ] Matrix -> Slack
    - [ ] Slack -> Matrix
- Topics
    - [ ] Matrix -> Slack
    - [ ] Slack -> Matrix


1. Cannot initiate a DM from Matrix to Slack currently [if the user
   on Slack has not yet spoken](https://github.com/matrix-org/matrix-appservice-slack/issues/211).
2. Can only bridge on reaction of each type, as the Slack bot
   can only react once. This is not a limitation for puppeted users.
3. Slack users cannot currently remove reactions on Matrix due
   to [a limitation](https://github.com/matrix-org/matrix-appservice-slack/issues/154).