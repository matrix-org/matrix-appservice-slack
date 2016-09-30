"use strict";

// Optionally try to load qrusage but don't depend on it
var qrusage;
try {
    qrusage = require("qrusage");
}
catch (e) {}

function Metrics() {
    // Only attempt to load these dependencies if metrics are enabled
    var Prometheus = require("prometheus-client");

    var client = this._client = new Prometheus();

    this._gauges = []; // just a list, order doesn't matter
    this._counters = {};

    // Register some built-in process-wide metrics

    this.addGauge({
        name: "process_mem",
        help: "memory usage in bytes",
        refresh: function(gauge) {
            var usage = process.memoryUsage();

            Object.keys(usage).forEach((key) => {
                gauge.set({type: key}, usage[key]);
            });
        }
    });

    // Node versions >= 6.2.0 have cpuUsage natively
    var cpuUsage = process.cpuUsage ||
        // otherwise, see if we can load it out of qrusage
        (qrusage && qrusage.cpuUsage);

    if (cpuUsage) {
        this.addGauge({
            name: "process_cpu",
            help: "CPU usage in microseconds",
            refresh: function(gauge) {
                var cpuusage = cpuUsage();

                gauge.set({type: "user"}, cpuusage.user);
                gauge.set({type: "system"}, cpuusage.system);
            }
        });
    }
    else {
        console.log("Unable to report cpuUsage in this version");
    }

    this.refresh();
};

Metrics.prototype.refresh = function() {
    this._gauges.forEach((i) => i.refresh());
};

Metrics.prototype.addGauge = function(opts) {
    var refresh = opts.refresh;
    var gauge = this._client.newGauge({
        namespace: "bridge",
        name: opts.name,
        help: opts.help,
    });

    this._gauges.push({
        gauge: gauge,
        refresh: function() { refresh(gauge) },
    });
};

Metrics.prototype.addCounter = function(opts) {
    this._counters[opts.name] = this._client.newCounter({
        namespace: "bridge",
        name: opts.name,
        help: opts.help,
    });
};

Metrics.prototype.incCounter = function(name, labels) {
    if (!this._counters[name]) {
        console.log("TODO: missing metric " + name);
        return;
    }

    this._counters[name].increment(labels);
};

Metrics.prototype.addAppServicePath = function(bridge) {
    var metricsFunc = this._client.metricsFunc();

    bridge.addAppServicePath({
        method: "GET",
        path: "/metrics",
        handler: (req, res) => {
            this.refresh();
            return metricsFunc(req, res);
        },
    });
};

var HOUR = 3600;
var DAY  = HOUR * 24;

function AgeCounters() {
    this["1h"] = 0;
    this["1d"] = 0;
    this["7d"] = 0;
    this["all"] = 0;
}
Metrics.AgeCounters = AgeCounters;

AgeCounters.prototype.bump = function(age) {
    if (age < HOUR   ) this["1h"]++;
    if (age < DAY    ) this["1d"]++;
    if (age < DAY * 7) this["7d"]++;

    this["all"]++;
};

AgeCounters.prototype.setGauge = function(gauge, morelabels) {
    Object.keys(this).forEach((age) => {
        // I wish I could use spread expressions
        var labels = {age: age};
        Object.keys(morelabels).forEach((k) => labels[k] = morelabels[k]);

        gauge.set(labels, this[age]);
    });
};

module.exports = Metrics;
