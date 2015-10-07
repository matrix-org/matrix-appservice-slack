function EchoSuppresser() {
    this.events = {};
}

EchoSuppresser.prototype.suppress = function(eventId) {
    this.events[eventId] = true;
};

EchoSuppresser.prototype.shouldSuppress = function(eventId) {
    if (this.events[eventId]) {
        delete this.events[eventId];
        return true;
    }
    return false;
}

module.exports = EchoSuppresser;
