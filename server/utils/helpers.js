'use strict';

const crypto = require('crypto');

function normalizeDeviceId(value) {
    const id = String(value || '').trim().toUpperCase();
    return /^[A-Z0-9._-]{1,128}$/.test(id) ? id : null;
}

function screenRoom(deviceId) {
    return `${deviceId}_screen`;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generateEventKey(deviceId, sessionId, service, eventType, status) {
    return crypto.createHash('sha256')
        .update(`${deviceId}|${sessionId}|${service}|${eventType}|${status}`)
        .digest('hex').slice(0, 32);
}

function generateChatEventKey(deviceId, app, conversation, direction, text, timestamp) {
    return crypto.createHash('sha256')
        .update([deviceId, app, conversation.toLowerCase(), direction, text, Math.floor(timestamp / 5000)].join('|'))
        .digest('hex');
}

function generateActivityEventId(deviceId, application, actorName, message) {
    return crypto.createHash('sha256')
        .update(`${deviceId}|${application}|${actorName}|${message}|final`)
        .digest('hex').slice(0, 28);
}

function generateFallbackChatEventId(deviceId, app, conversation, body, timestamp) {
    return crypto.createHash('sha256')
        .update(`${deviceId}|${app}|${conversation}|OUT|${body}|${timestamp}`)
        .digest('hex');
}

module.exports = {
    normalizeDeviceId,
    screenRoom,
    escapeHtml,
    generateEventKey,
    generateChatEventKey,
    generateActivityEventId,
    generateFallbackChatEventId
};
