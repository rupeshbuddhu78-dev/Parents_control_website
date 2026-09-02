'use strict';

function errorHandler(err, req, res, _next) {
    console.error('[UNHANDLED_ERROR]', err && err.message);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
