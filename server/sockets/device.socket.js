'use strict';

const deviceService = require('../services/device.service');

function deviceSocket(io, socket) {
    // Helper: check if socket is authorized for a target device
    function isAuthorizedForDevice(targetId) {
        if (socket.isDevice || socket.isAdmin || socket.isAnonymous) return true; // backward compat
        if (socket.isParent && socket.user) {
            const normalized = String(targetId).trim().toUpperCase().replace(/_SCREEN$/, '');
            return socket.user.devices && socket.user.devices.includes(normalized);
        }
        return false;
    }

    // Command relay (from website to phone)
    socket.on('command', (data) => {
        if (data && data.target && data.command) {
            const targetRoom = data.target.toString();

            // Auth check
            if (!isAuthorizedForDevice(targetRoom)) {
                socket.emit('auth-error', { message: 'Not authorized to send commands to this device' });
                return;
            }

            console.log(`Relaying Command: ${data.command} -> ${targetRoom}`);
            socket.to(targetRoom).emit('command', data);
        }
    });

    // Send-command with control-event support
    socket.on('send-command', (data) => {
        if (data.targetId && data.command) {
            // Auth check
            if (!isAuthorizedForDevice(data.targetId)) {
                socket.emit('auth-error', { message: 'Not authorized for this device' });
                return;
            }

            console.log(`Socket Command: ${data.command} -> ${data.targetId}`, data.x !== undefined ? `x=${data.x} y=${data.y}` : '');
            const { CONTROL_COMMANDS } = require('../config/constants');
            if (CONTROL_COMMANDS.includes(data.command)) {
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
                const baseRoom = data.targetId.replace('_screen', '');
                io.to(baseRoom).emit('command', data.command);
                if (!deviceService.getDevice(baseRoom)) deviceService.setDevice(baseRoom, { id: baseRoom });
                deviceService.setCommand(baseRoom, data.command);
            }
        }
    });

    // Command acknowledgment from Android
    socket.on('command-ack', (data) => {
        if (data && data.target) {
            const targetRoom = data.target.toString();
            io.to(targetRoom).emit('command-ack', data);
        }
    });
}

module.exports = deviceSocket;
