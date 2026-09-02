'use strict';

const deviceService = require('../services/device.service');

// GET /api/admin/all-devices
function getAllDevices(req, res) {
    res.json(deviceService.getAllDevices());
}

// GET /api/device-status/:id
function getDeviceStatus(req, res) {
    const id = req.params.id.toUpperCase().trim();
    res.json(deviceService.getDeviceStatus(id));
}

// POST /api/status
function postStatus(req, res) {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon, accuracy, speed } = req.body;
        if (!device_id) return res.status(400).json({ error: "No ID" });
        const id = device_id.toString().trim().toUpperCase();
        deviceService.setDevice(id, {
            model: model || (deviceService.getDevice(id) && deviceService.getDevice(id).model) || "Unknown",
            battery: battery || level || (deviceService.getDevice(id) && deviceService.getDevice(id).battery) || 0,
            version: version || (deviceService.getDevice(id) && deviceService.getDevice(id).version) || "--",
            charging: (String(charging) === "true"),
            lat: lat || (deviceService.getDevice(id) && deviceService.getDevice(id).lat) || 0,
            lon: lon || (deviceService.getDevice(id) && deviceService.getDevice(id).lon) || 0,
            accuracy: accuracy || (deviceService.getDevice(id) && deviceService.getDevice(id).accuracy) || 0,
            speed: speed || (deviceService.getDevice(id) && deviceService.getDevice(id).speed) || 0,
            lastSeen: Date.now()
        });
        const commandToSend = deviceService.consumeCommand(id);
        res.json({ status: "success", command: commandToSend });
    } catch (e) {
        res.status(500).json({ error: "Server Error" });
    }
}

module.exports = { getAllDevices, getDeviceStatus, postStatus };
