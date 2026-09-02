'use strict';

const screenService = require('../services/screen.service');

function screenSocket(io, socket) {
    // Accessibility screenshot stream: metadata + binary JPEG
    socket.on('screen-frame', (metadata, jpeg) => {
        try {
            const result = screenService.storeScreenFrame(metadata, jpeg);
            if (!result) return;
            io.to(screenService.screenRoom(result.id)).volatile.emit('screen-frame', result.meta, result.buffer);
        } catch (error) {
            console.error('screen-frame relay failed:', error.message);
        }
    });

    socket.on('screen-status', (payload) => {
        try {
            const result = screenService.storeScreenStatus(payload);
            if (!result) return;
            io.to(screenService.screenRoom(result.id)).emit('screen-status', result.status);
        } catch (error) {
            console.error('screen-status relay failed:', error.message);
        }
    });

    // Screen WebRTC DataChannel signaling (frames go P2P, not through server)
    socket.on('screen-p2p-request', (data) => {
        try {
            if (!data) return;
            const target = data.target || data.deviceId;
            if (!target) return;
            const payload = {
                ...data,
                parentSocketId: data.parentSocketId || socket.id,
                senderSocketId: socket.id,
                requesterSocketId: socket.id
            };
            const raw = String(target).trim();
            const upper = raw.toUpperCase().replace(/_SCREEN$/i, '');
            const rooms = new Set([
                raw,
                raw.toUpperCase(),
                raw.toLowerCase(),
                upper,
                upper + '_screen',
                upper + '_SCREEN',
                raw + '_screen',
                String(raw).replace(/_screen$/i, '') + '_screen'
            ]);
            console.log('screen-p2p-request ->', [...rooms].join(','), 'from', socket.id);
            for (const room of rooms) {
                io.to(room).emit('screen-p2p-request', payload);
            }
        } catch (e) {
            console.error('screen-p2p-request relay failed:', e.message);
        }
    });

    socket.on('screen-offer', (data) => {
        try {
            if (!data || !data.targetSocketId) return;
            io.to(String(data.targetSocketId)).emit('screen-offer', {
                ...data,
                senderSocketId: socket.id
            });
        } catch (e) {
            console.error('screen-offer relay failed:', e.message);
        }
    });

    socket.on('screen-answer', (data) => {
        try {
            if (!data || !data.targetSocketId) return;
            io.to(String(data.targetSocketId)).emit('screen-answer', {
                ...data,
                senderSocketId: socket.id
            });
        } catch (e) {
            console.error('screen-answer relay failed:', e.message);
        }
    });

    socket.on('screen-candidate', (data) => {
        try {
            if (!data || !data.targetSocketId) return;
            io.to(String(data.targetSocketId)).emit('screen-candidate', {
                ...data,
                senderSocketId: socket.id
            });
        } catch (e) {
            console.error('screen-candidate relay failed:', e.message);
        }
    });
}

module.exports = screenSocket;
