'use strict';

function controlSocket(io, socket) {
    // Helper: check if socket is authorized for a target device
    function isAuthorizedForDevice(targetId) {
        if (socket.isDevice || socket.isAdmin || socket.isAnonymous) return true;
        if (socket.isParent && socket.user) {
            const normalized = String(targetId).trim().toUpperCase();
            return socket.user.devices && socket.user.devices.includes(normalized);
        }
        return false;
    }

    // Screen control from parent dashboard
    socket.on('control-event', (data) => {
        if (!data || !data.room) return;

        // Auth check
        if (!isAuthorizedForDevice(data.room)) {
            socket.emit('auth-error', { message: 'Not authorized for this device' });
            return;
        }

        console.log(`Control Action: ${data.action} -> Target: ${data.room}`);
        io.to(data.room).emit('control-event', data);
    });

    // Screen control with full payload (x, y, coordinates, duration, etc.)
    socket.on('screen-control', (data) => {
        if (data && data.targetId && data.command) {
            // Auth check
            if (!isAuthorizedForDevice(data.targetId)) {
                socket.emit('auth-error', { message: 'Not authorized for this device' });
                return;
            }

            const targetRoom = data.targetId.toString();
            console.log(`Screen Control: ${data.command} -> ${targetRoom}`, JSON.stringify(data));
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

    // Audio stream relay
    socket.on('audio-stream', (blob) => {
        const rooms = socket.rooms;
        for (const room of rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('audio-stream', blob);
            }
        }
    });
}

module.exports = controlSocket;
