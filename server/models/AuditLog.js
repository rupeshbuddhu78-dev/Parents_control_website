'use strict';

const { mongoose } = require('../config/db');

const AuditLogSchema = new mongoose.Schema({
    action: { type: String, required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    targetId: { type: String, default: '' },
    targetType: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
}, { collection: 'audit_logs' });

AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ actorId: 1, timestamp: -1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);

module.exports = AuditLog;
