'use strict';

const deviceService = require('../services/device.service');

// POST /api/send-command
function sendCommand(req, res, io) {
    let { device_id, deviceId, command } = req.body;
    let targetID = device_id || deviceId;
    if (!targetID || !command) return res.status(400).json({ error: "Missing Info" });
    const id = targetID.toUpperCase().trim();
    io.to(id).emit('command', command);
    console.log(`Command Sent via API: ${command} -> ${id}`);
    deviceService.setDevice(id, { lastSeen: 0 });
    deviceService.setCommand(id, command);
    res.json({ status: "success", command: command });
}

module.exports = { sendCommand };
