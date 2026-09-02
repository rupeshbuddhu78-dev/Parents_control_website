'use strict';

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const DeviceMeta = require('../models/DeviceMeta');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const DeviceCredential = require('../models/DeviceCredential');
const auditService = require('../services/audit.service');
const authService = require('../services/auth.service');

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

// GET /api/admin/dashboard
async function getDashboard(req, res) {
    try {
        // Get all parent users to count their actual devices
        const parents = await User.find({ role: 'PARENT' }).select('devices lastLogin').lean();
        
        // Count unique devices that are actually assigned to parents
        const assignedDeviceIds = new Set();
        parents.forEach(parent => {
            (parent.devices || []).forEach(deviceId => {
                assignedDeviceIds.add(String(deviceId).toUpperCase());
            });
        });
        
        const [totalParents, activeParents, suspendedParents, activeSubscriptions] = await Promise.all([
            User.countDocuments({ role: 'PARENT' }),
            User.countDocuments({ role: 'PARENT', status: 'active' }),
            User.countDocuments({ role: 'PARENT', status: 'suspended' }),
            Subscription.countDocuments({ status: 'active' }),
        ]);
        
        res.json({
            totalParents, 
            activeParents, 
            suspendedParents,
            totalDevices: assignedDeviceIds.size, // Only count devices assigned to parents
            activeSubscriptions,
        });
    } catch (e) {
        res.status(500).json({ error: 'Dashboard data failed' });
    }
}

// GET /api/admin/parents
async function getParents(req, res) {
    try {
        const { search, status, page = 1, limit = 50 } = req.query;
        const query = { role: 'PARENT' };
        if (status) query.status = status;
        if (search) {
            const s = String(search).trim();
            query.$or = [
                { email: { $regex: s, $options: 'i' } },
                { name: { $regex: s, $options: 'i' } },
            ];
        }
        const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);
        const [parents, total] = await Promise.all([
            User.find(query)
                .select('-password -emailVerificationToken -passwordResetToken')
                .sort({ registeredAt: -1 })
                .skip(skip)
                .limit(Math.min(100, parseInt(limit) || 50))
                .lean(),
            User.countDocuments(query),
        ]);
        res.json({ parents, total, page: parseInt(page), totalPages: Math.ceil(total / (parseInt(limit) || 50)) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get parents' });
    }
}

// GET /api/admin/parents/:id
async function getParentDetail(req, res) {
    try {
        const parent = await User.findById(req.params.id)
            .select('-password -emailVerificationToken -passwordResetToken')
            .lean();
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        // Get devices info
        const deviceIds = (parent.devices || []).map(d => String(d).toUpperCase());
        const devices = deviceIds.length
            ? await DeviceMeta.find({ deviceId: { $in: deviceIds } }).lean()
            : [];

        // Get subscription
        let subscription = null;
        if (parent.activeSubscription) {
            subscription = await Subscription.findById(parent.activeSubscription).populate('planId').lean();
        }

        // Get active sessions
        const activeTokens = await RefreshToken.countDocuments({ userId: parent._id, isRevoked: false, expiresAt: { $gt: new Date() } });

        res.json({ parent, devices, subscription, activeSessions: activeTokens });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get parent details' });
    }
}

// POST /api/admin/parents/:id/suspend
async function suspendParent(req, res) {
    try {
        const { reason } = req.body;
        const parent = await User.findById(req.params.id);
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        parent.status = 'suspended';
        parent.suspendedAt = new Date();
        parent.suspendedBy = req.user.email;
        parent.suspendReason = reason || '';
        await parent.save();

        // Force logout
        await authService.forceLogoutUser(parent._id);

        await auditService.logAction({
            action: 'PARENT_SUSPENDED',
            actorId: req.user._id,
            actorEmail: req.user.email,
            actorRole: 'ADMIN',
            targetId: String(parent._id),
            targetType: 'parent',
            details: { reason: reason || '' },
            ip: getClientIp(req),
        });

        res.json({ success: true, message: 'Parent suspended' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to suspend parent' });
    }
}

// POST /api/admin/parents/:id/unsuspend
async function unsuspendParent(req, res) {
    try {
        const parent = await User.findById(req.params.id);
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        parent.status = 'active';
        parent.suspendedAt = null;
        parent.suspendedBy = null;
        parent.suspendReason = null;
        await parent.save();

        await auditService.logAction({
            action: 'PARENT_UNSUSPENDED',
            actorId: req.user._id,
            actorEmail: req.user.email,
            actorRole: 'ADMIN',
            targetId: String(parent._id),
            targetType: 'parent',
            ip: getClientIp(req),
        });

        res.json({ success: true, message: 'Parent unsuspended' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to unsuspend parent' });
    }
}

// POST /api/admin/parents/:id/force-logout
async function forceLogout(req, res) {
    try {
        const parent = await User.findById(req.params.id);
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        await authService.forceLogoutUser(parent._id);

        await auditService.logAction({
            action: 'PARENT_FORCE_LOGOUT',
            actorId: req.user._id,
            actorEmail: req.user.email,
            actorRole: 'ADMIN',
            targetId: String(parent._id),
            targetType: 'parent',
            ip: getClientIp(req),
        });

        res.json({ success: true, message: 'Parent logged out' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to force logout' });
    }
}

// POST /api/admin/parents/:id/disable
async function disableParent(req, res) {
    try {
        const parent = await User.findById(req.params.id);
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        parent.status = 'banned';
        await parent.save();
        await authService.forceLogoutUser(parent._id);

        await auditService.logAction({
            action: 'PARENT_DISABLED',
            actorId: req.user._id,
            actorEmail: req.user.email,
            actorRole: 'ADMIN',
            targetId: String(parent._id),
            targetType: 'parent',
            ip: getClientIp(req),
        });

        res.json({ success: true, message: 'Parent account disabled' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to disable parent' });
    }
}

// POST /api/admin/parents/:id/enable
async function enableParent(req, res) {
    try {
        const parent = await User.findById(req.params.id);
        if (!parent || parent.role !== 'PARENT') return res.status(404).json({ error: 'Parent not found' });

        parent.status = 'active';
        parent.suspendedAt = null;
        parent.suspendedBy = null;
        parent.suspendReason = null;
        await parent.save();

        await auditService.logAction({
            action: 'PARENT_ENABLED',
            actorId: req.user._id,
            actorEmail: req.user.email,
            actorRole: 'ADMIN',
            targetId: String(parent._id),
            targetType: 'parent',
            ip: getClientIp(req),
        });

        res.json({ success: true, message: 'Parent account enabled' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to enable parent' });
    }
}

// GET /api/admin/devices
async function getAllDevices(req, res) {
    try {
        const { search, page = 1, limit = 50 } = req.query;
        const query = {};
        if (search) {
            const s = String(search).trim();
            query.$or = [
                { deviceId: { $regex: s, $options: 'i' } },
                { model: { $regex: s, $options: 'i' } },
            ];
        }
        const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 50);
        const [devices, total] = await Promise.all([
            DeviceMeta.find(query).sort({ updatedAt: -1 }).skip(skip).limit(Math.min(100, parseInt(limit) || 50)).lean(),
            DeviceMeta.countDocuments(query),
        ]);

        // For each device, find the owner
        const deviceIds = devices.map(d => d.deviceId);
        const owners = await User.find({ devices: { $in: deviceIds }, role: 'PARENT' })
            .select('_id email name devices').lean();

        const ownerMap = {};
        for (const owner of owners) {
            for (const d of (owner.devices || [])) {
                ownerMap[String(d).toUpperCase()] = { _id: owner._id, email: owner.email, name: owner.name };
            }
        }

        const enriched = devices.map(d => ({
            ...d,
            owner: ownerMap[String(d.deviceId).toUpperCase()] || null,
        }));

        res.json({ devices: enriched, total, page: parseInt(page) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get devices' });
    }
}

// GET /api/admin/audit-logs
async function getAuditLogs(req, res) {
    try {
        const { action, actorId, targetId, limit = 100, skip = 0 } = req.query;
        const logs = await auditService.getAuditLogs({
            action, actorId, targetId,
            limit: Math.min(500, parseInt(limit) || 100),
            skip: parseInt(skip) || 0,
        });
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get audit logs' });
    }
}

// GET /api/admin/subscriptions
async function getSubscriptions(req, res) {
    try {
        const subs = await Subscription.find({})
            .populate('userId', 'email name')
            .populate('planId', 'name slug price billingPeriod')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json({ subscriptions: subs });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get subscriptions' });
    }
}

// GET /api/admin/payments
async function getPayments(req, res) {
    try {
        const payments = await Payment.find({})
            .populate('userId', 'email name')
            .populate('planId', 'name price')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        res.json({ payments });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get payments' });
    }
}

module.exports = {
    getDashboard, getParents, getParentDetail,
    suspendParent, unsuspendParent, forceLogout,
    disableParent, enableParent,
    getAllDevices, getAuditLogs,
    getSubscriptions, getPayments,
};
