'use strict';

const User = require('../models/User');

/**
 * Middleware: Verify that the device_id in the request belongs to the authenticated parent.
 * Skips verification for ADMIN role.
 * Attaches req.deviceId (normalized uppercase) on success.
 */
function verifyDeviceOwnership(req, res, next) {
    // Extract device_id from various locations
    const deviceId = (
        req.params.device_id ||
        req.params.deviceId ||
        req.params.id ||
        req.body.device_id ||
        req.body.deviceId ||
        req.query.device ||
        req.query.deviceId ||
        req.query.childId ||
        req.headers['x-device-id'] ||
        ''
    ).toString().trim().toUpperCase();

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID required' });
    }

    // Admin can access any device
    if (req.user && req.user.role === 'ADMIN') {
        req.deviceId = deviceId;
        return next();
    }

    // Parent must own the device
    if (!req.user || req.user.role !== 'PARENT') {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // We'll do an async check
    User.findById(req.user._id).select('devices status').lean()
        .then(user => {
            if (!user) return res.status(401).json({ error: 'Account not found' });
            if (user.status !== 'active') return res.status(403).json({ error: 'Account not active' });

            const ownedDevices = (user.devices || []).map(d => String(d).toUpperCase());
            if (!ownedDevices.includes(deviceId)) {
                return res.status(403).json({ error: 'Device not owned by this account' });
            }

            req.deviceId = deviceId;
            next();
        })
        .catch(() => res.status(500).json({ error: 'Ownership verification failed' }));
}

/**
 * For Socket.IO: verify device ownership for a given userId and deviceId.
 * Returns { allowed: boolean, reason?: string }
 */
async function verifyDeviceOwnershipSync(userId, deviceId, role) {
    if (role === 'ADMIN') return { allowed: true };
    try {
        const user = await User.findById(userId).select('devices status').lean();
        if (!user) return { allowed: false, reason: 'Account not found' };
        if (user.status !== 'active') return { allowed: false, reason: 'Account not active' };
        const ownedDevices = (user.devices || []).map(d => String(d).toUpperCase());
        const normalized = String(deviceId).trim().toUpperCase();
        if (!ownedDevices.includes(normalized)) {
            return { allowed: false, reason: 'Device not owned' };
        }
        return { allowed: true };
    } catch (e) {
        return { allowed: false, reason: 'Verification error' };
    }
}

module.exports = { verifyDeviceOwnership, verifyDeviceOwnershipSync };
