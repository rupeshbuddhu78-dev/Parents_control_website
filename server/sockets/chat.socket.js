'use strict';

const path = require('path');
const fs = require('fs');
const chatService = require('../services/chat.service');

function chatSocket(io, socket) {
    // Chat batch upload from Android via Socket.IO
    socket.on('chat_batch', async (data) => {
        if (data && data.device_id && Array.isArray(data.messages)) {
            const id = data.device_id.toString().trim().toUpperCase();
            const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
            await chatService.processSocketChatBatch(id, data.messages, UPLOADS_DIR, io);
        }
    });
}

module.exports = chatSocket;
