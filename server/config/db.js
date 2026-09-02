'use strict';

const mongoose = require('mongoose');
const env = require('./env');

let connected = false;

async function connect() {
    if (!env.MONGODB_URI) {
        console.warn('MONGODB_URI not set');
        return false;
    }
    if (connected && mongoose.connection.readyState === 1) return true;
    connected = false;
    try {
        await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
        connected = true;
        console.log('MongoDB connected', mongoose.connection.name);
        return true;
    } catch (e) {
        console.error('MongoDB connect failed', e.message);
        return false;
    }
}

function isReady() {
    return connected && mongoose.connection.readyState === 1;
}

async function ensureReady() {
    if (isReady()) return true;
    try {
        const ok = await connect();
        return ok && isReady();
    } catch (e) {
        console.error('[MONGO_RECONNECT_FAILED]', e && e.message);
        return false;
    }
}

mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('MongoDB disconnected; writes will be retried after reconnect');
});

mongoose.connection.on('error', (err) => {
    if (mongoose.connection.readyState !== 1) connected = false;
    console.error('MongoDB connection error', err && err.message);
});

module.exports = { connect, isReady, ensureReady, mongoose };
