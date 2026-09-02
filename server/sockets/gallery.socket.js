'use strict';

const crypto = require('crypto');

function gallerySocket(io, socket) {
    // Gallery P2P signaling
    socket.on('gallery-request', (data) => {
        if (!data || !data.target) return;
        const targetRoom = String(data.target).trim().toUpperCase();
        socket.to(targetRoom).emit('gallery-request', {
            requestId: String(data.requestId || crypto.randomUUID()),
            parentSocketId: socket.id,
            deviceId: targetRoom,
            mediaType: String(data.mediaType || 'images') === 'videos' ? 'videos' : 'images',
            offset: Math.max(0, Number(data.offset || 0)),
            limit: Math.min(2000, Math.max(1, Number(data.limit || 2000)))
        });
    });

    socket.on('gallery-offer', (data) => {
        if (!data || !data.targetSocketId || !data.offer) return;
        io.to(String(data.targetSocketId)).emit('gallery-offer', { ...data, senderSocketId: socket.id });
    });

    socket.on('gallery-fallback-request', (data) => {
        if (!data) return;
        const targetRoom = String(data.target || data.device_id || '').trim().toUpperCase();
        if (!targetRoom) return;
        socket.to(targetRoom).emit('gallery-fallback-request', {
            requestId: String(data.requestId || crypto.randomUUID()),
            parentSocketId: socket.id,
            deviceId: targetRoom,
            mediaType: String(data.mediaType || 'images') === 'videos' ? 'videos' : 'images'
        });
    });

    socket.on('gallery-answer', (data) => {
        if (!data || !data.targetSocketId || !data.answer) return;
        io.to(String(data.targetSocketId)).emit('gallery-answer', { ...data, senderSocketId: socket.id });
    });

    socket.on('gallery-candidate', (data) => {
        if (!data || !data.targetSocketId || !data.candidate) return;
        io.to(String(data.targetSocketId)).emit('gallery-candidate', { ...data, senderSocketId: socket.id });
    });

    socket.on('gallery-progress', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-progress', data);
    });

    socket.on('gallery-complete', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-complete', data);
    });

    socket.on('gallery-fallback-complete', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-fallback-complete', data);
    });

    socket.on('gallery-error', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-error', data);
    });

    // Gallery Socket.IO relay (when WebRTC P2P ICE fails)
    socket.on('gallery-relay-start', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-start', data);
    });

    socket.on('gallery-relay-manifest', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-manifest', data);
    });

    socket.on('gallery-relay-file-start', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-file-start', data);
    });

    socket.on('gallery-relay-chunk', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-chunk', data);
    });

    socket.on('gallery-relay-file-end', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-file-end', data);
    });

    socket.on('gallery-relay-complete', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-relay-complete', data);
    });

    socket.on('gallery-delete', (data) => {
        if (!data || !data.target) return;
        socket.to(String(data.target).trim().toUpperCase()).emit('gallery-delete', {
            ...data,
            requesterSocketId: socket.id
        });
    });

    socket.on('gallery-delete-ack', (data) => {
        if (!data || !data.targetSocketId) return;
        io.to(String(data.targetSocketId)).emit('gallery-delete-ack', data);
    });
}

module.exports = gallerySocket;
