'use strict';

const { mongoose } = require('../config/db');

const DeviceMetaSchema = new mongoose.Schema({
    deviceId: { type: String, unique: true, index: true },
    model: String,
    pin: String,
    network: mongoose.Schema.Types.Mixed,
    lastLocation: mongoose.Schema.Types.Mixed,
    lastSeen: Number,
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'devices' });

const DeviceMeta = mongoose.models.DeviceMeta || mongoose.model('DeviceMeta', DeviceMetaSchema);

module.exports = DeviceMeta;
