"use strict";

// Ordered
var substitutionPairs = [];

function add(slack, matrix) {
    substitutionPairs.push({
        slack: slack,
        matrix: matrix
    });
}

// slack -> matrix substitutions are performed top -> bottom
// matrix -> slack substitutions are performed bottom -> top
add("&lt;", "<");
add("&gt;", ">");
add("&amp;", "&"); // &amp; must be after all replacements involving &s.

var slackToMatrix = function(string) {
    for (var i = 0; i < substitutionPairs.length; ++i) {
        var pair = substitutionPairs[i];
        string = string.replace(pair.slack, pair.matrix);
    }
    return string;
};

var matrixToSlack = function(string) {
    for (var i = substitutionPairs.length - 1; i >= 0; --i) {
        var pair = substitutionPairs[i];
        string = string.replace(pair.matrix, pair.slack);
    }
    return string;
};

module.exports = {
    "matrixToSlack": matrixToSlack,
    "slackToMatrix": slackToMatrix
};
