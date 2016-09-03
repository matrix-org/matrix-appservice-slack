var Promise = require('bluebird');

// promiseWhile code from http://blog.victorquinn.com/javascript-promise-while-loop
var promiseWhile = function(condition, action) {
    var resolver = Promise.defer();

    var loop = function() {
        if (!condition()) return resolver.resolve();
        return Promise.cast(action())
            .then(loop)
            .catch(resolver.reject);
    };

    process.nextTick(loop);

    return resolver.promise;
};

module.exports = promiseWhile;
