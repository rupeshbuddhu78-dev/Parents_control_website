'use strict';

const constants = require('../config/constants');
const { normalizeDeviceId, screenRoom } = require('../utils/helpers');
const deviceService = require('./device.service');

const latestScreenFrames = new Map();
const latestScreenStatus = new Map();

function storeScreenFrame(metadata, jpegBuffer) {
    const id = normalizeDeviceId(metadata && metadata.deviceId);
    if (!id || !jpegBuffer) return null;
    const buffer = Buffer.isBuffer(jpegBuffer) ? jpegBuffer : Buffer.from(jpegBuffer);
    if (!buffer.length || buffer.length > constants.SCREEN_MAX_FRAME_SIZE) return null;
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
    deviceService.setDevice(id, { lastSeen: Date.now(), screenOnline: true });
    return { id, meta, buffer };
}

function getLatestScreenFrame(deviceId) {
    const id = normalizeDeviceId(deviceId);
    return id ? latestScreenFrames.get(id) : null;
}

function storeScreenStatus(payload) {
    const id = normalizeDeviceId(payload && payload.deviceId);
    if (!id) return null;
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
    deviceService.setDevice(id, {
        lastSeen: Date.now(),
        screenStatus: status.status,
        screenOnline: status.status !== 'SCREEN_STREAM_STOPPED'
    });
    return { id, status };
}

function getLatestScreenStatus(deviceId) {
    const id = normalizeDeviceId(deviceId);
    return id ? latestScreenStatus.get(id) : null;
}

module.exports = {
    latestScreenFrames,
    latestScreenStatus,
    storeScreenFrame,
    getLatestScreenFrame,
    storeScreenStatus,
    getLatestScreenStatus,
    normalizeScreenDeviceId: normalizeDeviceId,
    screenRoom
};
