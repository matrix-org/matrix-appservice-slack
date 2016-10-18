"use strict";

var fs = require("fs");

var TICKS_PER_SEC = 100; // TODO(paul): look this up via sysconf(_SC_CLK_TCK)
var USEC = 1e6;

function Metrics() {
    // Only attempt to load these dependencies if metrics are enabled
    var Prometheus = require("prometheus-client");

    var client = this._client = new Prometheus();

    this._gauges = []; // just a list, order doesn't matter
    this._counters = {};

    // Register some built-in process-wide metrics
    // See also
    //   https://prometheus.io/docs/instrumenting/writing_clientlibs/#standard-and-runtime-collectors

    var rss_gauge = this.addGauge({
        namespace: "process",
        name: "resident_memory_bytes",
        help: "Resident memory size in bytes",
    });
    var vsz_gauge = this.addGauge({
        namespace: "process",
        name: "virtual_memory_bytes",
        help: "Virtual memory size in bytes",
    });

    var heap_size_gauge = this.addGauge({
        namespace: "process",
        name: "heap_bytes",
        help: "Total size of Node.js heap in bytes",
    });
    var heap_used_gauge = this.addGauge({
        namespace: "nodejs",
        name: "heap_used_bytes",
        help: "Used size of Node.js heap in bytes",
    });

    // legacy name
    this.addGauge({
        name: "process_mem",
        help: "memory usage in bytes",
        refresh: function(gauge) {
            var usage = process.memoryUsage();

            Object.keys(usage).forEach((key) => {
                gauge.set({type: key}, usage[key]);
            });

            rss_gauge.set({}, usage.rss);
            heap_size_gauge.set({}, usage.heapTotal);
            heap_used_gauge.set({}, usage.heapUsed);
        }
    });

    var cpu_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_seconds_total",
        help: "Total user and system CPU time spent in seconds",
    });

    var cpu_user_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_user_seconds_total",
        help: "Total user CPU time spent in seconds",
    });
    var cpu_system_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_system_seconds_total",
        help: "Total system CPU time spent in seconds",
    });

    this.addGauge({
        name: "process_cpu",
        help: "CPU usage in microseconds",
        refresh: function(gauge) {
            var stats = _read_proc_self_stat();

            // CPU times in ticks
            var utime_secs = stats[11] / TICKS_PER_SEC;
            var stime_secs = stats[12] / TICKS_PER_SEC;

            cpu_gauge.set({}, utime_secs + stime_secs);
            cpu_user_gauge.set({}, utime_secs);
            cpu_system_gauge.set({}, stime_secs);

            gauge.set({type: "user"}, utime_secs * USEC);
            gauge.set({type: "system"}, stime_secs * USEC);

            // Virtual memory size
            vsz_gauge.set({}, stats[20]);
        }
    });

    this.addGauge({
        namespace: "process",
        name: "open_fds",
        help: "Number of open file descriptors",
        refresh: function(gauge) {
            var fds = fs.readdirSync("/proc/self/fd");

            // subtract 1 due to readdir handle itself
            gauge.set(null, fds.length - 1);
        }
    });

    this.addGauge({
        namespace: "process",
        name: "max_fds",
        help: "Maximum number of open file descriptors allowed",
        refresh: function(gauge) {
            var limits = fs.readFileSync("/proc/self/limits");
            limits.toString().split(/\n/).forEach((line) => {
                if (!line.match(/^Max open files /)) return;

                // "Max", "open", "files", $SOFT, $HARD, "files"
                gauge.set({}, line.split(/\s+/)[3]);
            });
        }
    });

    // This value will be constant for the lifetime of the process
    this.addGauge({
        namespace: "process",
        name: "start_time_seconds",
        help: "Start time of the process since unix epoch in seconds",
    }).set({}, _calculate_process_start_time());

    this.refresh();
};

function _read_proc_self_stat() {
    var stat_line = fs.readFileSync("/proc/self/stat")
        .toString().split(/\n/)[0];
    // Line contains PID (exec_name) bunch of stats here...
    return stat_line.match(/\) +(.*)$/)[1].split(" ");
}

function _calculate_process_start_time() {
    // The 'starttime' field in /proc/self/stat gives the number of CPU ticks
    //   since machine boot time that this process started.
    var stats = _read_proc_self_stat();
    var starttime_sec = stats[19] / TICKS_PER_SEC;

    var btime_line = fs.readFileSync("/proc/stat")
        .toString().split(/\n/).filter((l) => l.match(/^btime /))[0];
    var btime = Number(btime_line.split(" ")[1]);

    return btime + starttime_sec;
}

Metrics.prototype.refresh = function() {
    this._gauges.forEach((i) => i.refresh && i.refresh(i.gauge));
};

Metrics.prototype.addGauge = function(opts) {
    var refresh = opts.refresh;
    var gauge = this._client.newGauge({
        namespace: opts.namespace || "bridge",
        name: opts.name,
        help: opts.help,
    });

    this._gauges.push({
        gauge: gauge,
        refresh: refresh,
    });

    return gauge;
};

Metrics.prototype.addCounter = function(opts) {
    this._counters[opts.name] = this._client.newCounter({
        namespace: opts.namespace || "bridge",
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
