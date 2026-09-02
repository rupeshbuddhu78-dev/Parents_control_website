'use strict';

const { mongoose } = require('../config/db');

const ChatMessageSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    app: { type: String, required: true, index: true },
    packageName: { type: String, default: '' },
    conversation: { type: String, required: true, index: true },
    conversationId: { type: String, default: '', index: true },
    contactName: { type: String, default: '' },
    sender: { type: String, default: '' },
    text: { type: String, default: '' },
    message: { type: String, default: '' },
    direction: { type: String, default: 'IN' },
    status: { type: String, default: 'received' },
    messageType: { type: String, default: 'TEXT' },
    source: { type: String, default: 'accessibility' },
    timestamp: { type: Number, default: Date.now, index: true },
    clientTimestamp: { type: Number, default: 0 },
    serverTimestamp: { type: Number, default: Date.now },
    eventId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
    msgKey: { type: String, required: true }
}, { collection: 'chat_messages' });

ChatMessageSchema.index({ deviceId: 1, app: 1, conversation: 1, timestamp: -1 });
ChatMessageSchema.index({ deviceId: 1, app: 1, msgKey: 1 }, { unique: true });

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);

module.exports = ChatMessage;
