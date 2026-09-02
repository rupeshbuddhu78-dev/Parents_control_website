'use strict';

const { mongoose } = require('../config/db');

const HistorySchema = new mongoose.Schema({
    deviceId: { type: String, index: true },
    type: { type: String, index: true },
    data: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'device_history' });

const History = mongoose.models.History || mongoose.model('History', HistorySchema);

module.exports = History;
