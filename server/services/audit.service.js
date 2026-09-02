'use strict';

const AuditLog = require('../models/AuditLog');

async function logAction({ action, actorId, actorEmail, actorRole, targetId, targetType, details, ip, userAgent }) {
    try {
        await AuditLog.create({
            action,
            actorId: actorId || null,
            actorEmail: actorEmail || '',
            actorRole: actorRole || '',
            targetId: targetId || '',
            targetType: targetType || '',
            details: details || {},
            ip: ip || '',
            userAgent: userAgent || '',
        });
    } catch (e) {
        console.error('[AUDIT_LOG_ERROR]', e.message);
    }
}

async function getAuditLogs({ action, actorId, targetId, limit = 100, skip = 0 } = {}) {
    const query = {};
    if (action) query.action = action;
    if (actorId) query.actorId = actorId;
    if (targetId) query.targetId = targetId;
    try {
        return await AuditLog.find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(Math.min(limit, 500))
            .lean();
    } catch (e) {
        return [];
    }
}

module.exports = { logAction, getAuditLogs };
