'use strict';

const { mongoose } = require('../config/db');

// Secure credential store for child devices
const DeviceCredentialSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    credentialHash: { type: String, default: null },
    credentialType: { type: String, enum: ['legacy', 'secure'], default: 'legacy' },
    isActive: { type: Boolean, default: true },
    lastAuthenticated: { type: Date, default: null },
    pairedAt: { type: Date, default: Date.now },
    migratedAt: { type: Date, default: null },
}, { collection: 'device_credentials' });

const DeviceCredential = mongoose.models.DeviceCredential || mongoose.model('DeviceCredential', DeviceCredentialSchema);

module.exports = DeviceCredential;
