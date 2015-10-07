function Usermap(config) {
    this.config = config;
    this.slackToMatrix = {};
    this.matrixToSlack = {}
    var self = this;
    if (config.users) {
        config.users.forEach(function(u) {
            self.slackToMatrix[u.slack.username] = u.matrix.username;
            self.matrixToSlack[u.matrix.username] = u.slack.username;
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

Usermap.prototype.slackForMatrix = function(matrix) {
    if (this.matrixToSlack[matrix]) {
        return this.matrixToSlack[matrix];
    }
    return null;
};

module.exports = Usermap;
