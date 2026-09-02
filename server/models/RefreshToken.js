'use strict';

const { mongoose } = require('../config/db');
const crypto = require('crypto');

const RefreshTokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    isRevoked: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
}, { collection: 'refresh_tokens' });

// Auto-generate token
RefreshTokenSchema.statics.generateToken = function () {
    return crypto.randomBytes(40).toString('hex');
};

// Index for cleanup
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', RefreshTokenSchema);

module.exports = RefreshToken;
