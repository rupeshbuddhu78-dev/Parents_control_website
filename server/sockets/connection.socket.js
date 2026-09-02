'use strict';

const screenService = require('../services/screen.service');

function connectionSocket(io, socket) {
    // Device joins its base room
    socket.on('join', (roomID) => {
        const room = roomID.toString().trim().toUpperCase();

        // Auth check: parents can only join their own device rooms
        if (socket.isParent && !socket.isAdmin) {
            if (!socket.user || !socket.user.devices || !socket.user.devices.includes(room)) {
                console.warn(`[SOCKET_AUTH] Parent ${socket.user?._id} denied join to room ${room}`);
                socket.emit('auth-error', { message: 'Not authorized to join this room' });
                return;
            }
        }

        socket.join(room);
        console.log(`Device Joined Room (Android): ${room}`);
    });

    // Client joins a room (parent dashboard)
    socket.on('join-room', (roomID) => {
        const room = roomID.toString().trim();

        // Auth check for parent users
        if (socket.isParent && !socket.isAdmin) {
            const normalizedRoom = room.toUpperCase().replace(/_SCREEN$/, '');
            if (!socket.user || !socket.user.devices || !socket.user.devices.includes(normalizedRoom)) {
                console.warn(`[SOCKET_AUTH] Parent ${socket.user?._id} denied join-room to ${room}`);
                socket.emit('auth-error', { message: 'Not authorized to join this room' });
                return;
            }
        }

        socket.join(room);
        console.log(`Client Joined Room: ${room}`);
        // If joining a screen room, send latest cached frame + status
        if (room.endsWith('_screen')) {
            const id = screenService.normalizeScreenDeviceId(room.slice(0, -'_screen'.length));
            const latest = id ? screenService.getLatestScreenFrame(id) : null;
            const status = id ? screenService.getLatestScreenStatus(id) : null;
            if (latest) socket.emit('screen-frame', latest.meta, latest.jpeg);
            if (status) socket.emit('screen-status', status);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
    });
}

module.exports = connectionSocket;
