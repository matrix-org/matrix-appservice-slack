#!/usr/bin/env node
"use strict";

var Promise = require("bluebird");
var Datastore = require("nedb");
Promise.promisifyAll(Datastore.prototype);
var nopt = require("nopt");
var fs = require("fs");
var yaml = require("js-yaml");

const ROOM_DB = "new-room-store.db";

var opts = nopt({
    help: Boolean,
    config: String,
}, {
    "h": "--help",
    "c": "--config",
});

if (!opts.help && !opts.config) {
    console.log("--config is required.");
    opts.help = true;
}

if (opts.help) {
    console.log(
`Database creation script
-------------------------

 Usage:
   --config  The path to the slack-config.yaml. Required.

A new room database file will be created called "new-room-store.db". The
config file will not be modified.
`
);
process.exit(0);
}

var config = yaml.safeLoad(fs.readFileSync(opts.config, "utf8"));

if (!config.rooms || !config.rooms.length) {
    console.log("No rooms found in this config file; nothing to upgrade");
    process.exit(1);
}

var insertions = [];

config.rooms.forEach((room_config) => {
    var slack_channel_id = room_config.slack_channel_id;
    insertions.push({
        id: slack_channel_id,
        remote_id: slack_channel_id,
        remote: {
            token: room_config.slack_api_token,
            webhook_uri: room_config.webhook_url,
        }
    });

    var matrix_room_ids = room_config.matrix_room_ids
        ? room_config.matrix_room_ids
        : [room_config.matrix_room_id];
    matrix_room_ids.forEach((matrix_room_id) => {
        var linkId = slack_channel_id + " " + matrix_room_id;

        insertions.push({
            id: linkId,
            remote_id: slack_channel_id,
            matrix_id: matrix_room_id,
        });
    });
});

var newRoomStore = new Datastore({
    filename: ROOM_DB,
    autoload: true,
});

newRoomStore.insert(insertions);

newRoomStore.ensureIndex({
    fieldName: "id",
    unique: true,
    sparse: false
});
newRoomStore.ensureIndex({
    fieldName: "matrix_id",
    unique: false,
    sparse: true
});
newRoomStore.ensureIndex({
    fieldName: "remote_id",
    unique: false,
    sparse: true
});

console.log(`

New database created.

Don't forget to remove (or at least comment out) the rooms list from your
existing config file to avoid loading these twice.
`);
