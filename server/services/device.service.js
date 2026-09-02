'use strict';

const constants = require('../config/constants');

// In-memory device status store
const devicesStatus = {};

function getDevice(id) {
    return devicesStatus[id] || null;
}

function setDevice(id, fields) {
    if (!devicesStatus[id]) devicesStatus[id] = { id };
    Object.assign(devicesStatus[id], fields);
    return devicesStatus[id];
}

function updateLastSeen(id) {
    if (!devicesStatus[id]) devicesStatus[id] = { id };
    devicesStatus[id].lastSeen = Date.now();
}

function isOnline(id) {
    const d = devicesStatus[id];
    if (!d || !d.lastSeen) return false;
    return (Date.now() - d.lastSeen) < constants.DEVICE_OFFLINE_MS;
}

function getCommand(id) {
    const d = devicesStatus[id];
    if (!d || !d.command || d.command === 'none') return 'none';
    return d.command;
}

function setCommand(id, command) {
    if (!devicesStatus[id]) devicesStatus[id] = { id };
    devicesStatus[id].command = command;
}

function consumeCommand(id) {
    const d = devicesStatus[id];
    if (!d || !d.command || d.command === 'none') return 'none';
    const cmd = d.command;
    d.command = 'none';
    return cmd;
}

function getAllDevices() {
    return { ...devicesStatus };
}

function getDeviceStatus(id) {
    const device = devicesStatus[id];
    if (!device) return { id, isOnline: false };
    return { ...device, isOnline: isOnline(id) };
}

module.exports = {
    devicesStatus,
    getDevice,
    setDevice,
    updateLastSeen,
    isOnline,
    getCommand,
    setCommand,
    consumeCommand,
    getAllDevices,
    getDeviceStatus
};
