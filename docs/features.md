Features
========

The list below is a exhuastive list of features that the bridge supports.

Symbols:
- 🇵 means that the feature is available to puppeted users.
- 🧪 means that the feature is experimental.

Notes:
- [1] - Users who are not puppeted are not able to send reactions as themselves.
- [2] - Matrix replies appear as threads on Slack. Slack threads appear as replies on Matrix.

## Channel Types

The bridge supports connecting all channel types to Matrix rooms.

- Public
- Private
- Group Chats 🇵
- DMs 🇵

## Content Types

These types are supported in both directions.

- Text / Formatted Text
- Images / Videos / Audio / Files
- Reactions [1]
- Redactions
- Edits
- Threading / Replies [2]
- Encrypted Messages 🧪

## Membership

Membership is synced from Slack so that all users who are inside the
Slack channel appear as members in the Matrix room. Members who are puppeted
on Matrix appear on Slack. 

- Sync channel membership to Matrix on startup
- Sync channel membership to Matrix when new users join
- Sync room membership to Slack on startup 🇵
- Sync Matrix users to Slack channels when they join Matrix rooms 🇵

## Channel/User Syncronisation

- Sync public Slack channels to the Matrix room directory on startup
- Sync members of the Slack workspace to Matix on startup

## Administration Features

- CLI interface via a Matrix admin room
- Configure rooms via a provisioning API and a compatible integration manager
- Metrics for the bridge are exposed via a prometheus compatible endpoint