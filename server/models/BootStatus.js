'use strict';

const { mongoose } = require('../config/db');

const BootStatusSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    bootSessionId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    serviceName: { type: String, default: '' },
    status: { type: String, default: 'SUCCESS' },
    message: { type: String, default: '' },
    eventKey: { type: String, required: true },
    timestamp: { type: Number, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'boot_status' });

BootStatusSchema.index({ deviceId: 1, eventKey: 1 }, { unique: true });
BootStatusSchema.index({ deviceId: 1, timestamp: -1 });

const BootStatus = mongoose.models.BootStatus || mongoose.model('BootStatus', BootStatusSchema);

module.exports = BootStatus;
