"use strict";

function SlackUser(opts) {
    this._intent = opts.intent;
}

SlackUser.prototype.getIntent = function() {
    return this._intent;
};

module.exports = SlackUser;
