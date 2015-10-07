function Usermap(config) {
    this.config = config;
    this.slackToMatrix = {};
    var self = this;
    if (config.users) {
        config.users.forEach(function(u) {
            self.slackToMatrix[u.slack.username] = u.matrix.username;
        });
    }
}

Usermap.prototype.matrixForSlack = function(slack) {
    if (this.slackToMatrix[slack]) {
        return this.slackToMatrix[slack];
    }
    return "@" + this.config.username_prefix + slack +
        ":" + this.config.homeserver.server_name;
};

module.exports = Usermap;
