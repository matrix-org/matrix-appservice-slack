# matrix-appservice-slack

[![Docker Automated build](https://img.shields.io/docker/cloud/build/matrixdotorg/matrix-appservice-slack.svg)](https://hub.docker.com/r/matrixdotorg/matrix-appservice-slack)
[![#slack:half-shot.uk](https://img.shields.io/matrix/slack:half-shot.uk.svg?server_fqdn=matrix.half-shot.uk&label=%23slack:half-shot.uk&logo=matrix)](https://matrix.to/#/#slack:half-shot.uk)
[![Build status](https://badge.buildkite.com/ebc25cba3c68c0e44db887be63fa28c4e337e115241c52cb74.svg)](https://buildkite.com/matrix-dot-org/matrix-appservice-slack)

A bridge that connects [Matrix](https://matrix.org) and [Slack](https://slack.com). 
The bridge is considered **stable** and mature for use in production
environments.

![Screenshot](./screenshot.png)

## Requirements

Hosting this bridge requires you to have a Matrix homeserver. In order to
connect a Slack Workspace to your bridge, you will need permission to add bots
to it. You will also need Node.JS 10+ or Docker on your system.

## Setting up

See [the getting started docs](./docs/getting_started.md) for instructions on how
to set up the bridge.

## Helping out

This bridge is a community project and welcomes issues and PRs from anyone who
has the time to spare. If you want to work on the bridge, please see
[CONTRIBUTING.md](https://github.com/matrix-org/matrix-appservice-slack/blob/develop/CONTRIBUTING.md).
Please come visit us in the 
[support room](https://matrix.to/#/#matrix_appservice_slack:cadair.com/) if you
have any questions.

# Documentation

- [Features](./docs/features)
- [Getting Started](./docs/getting_started)
- [Linking Channels](./docs/link_channels)
- [Datastores](./docs/datastores)
