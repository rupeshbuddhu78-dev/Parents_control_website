'use strict';

function info(tag, msg) {
    console.log(`[${tag}]`, msg);
}

function warn(tag, msg) {
    console.warn(`[${tag}]`, msg);
}

function error(tag, msg) {
    console.error(`[${tag}]`, msg);
}

function json(tag, data) {
    console.log(`[${tag}]`, JSON.stringify(data));
}

module.exports = { info, warn, error, json };
