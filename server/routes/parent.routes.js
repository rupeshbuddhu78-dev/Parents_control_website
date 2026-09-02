'use strict';

const express = require('express');
const router = express.Router();
const { authenticateUser, checkAccountStatus } = require('../middleware/auth');
const User = require('../models/User');

// POST /api/parent/add-device
router.post('/parent/add-device', authenticateUser, checkAccountStatus, async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

        const normalizedId = String(deviceId).trim().toUpperCase();

        // Check plan device limit
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let deviceLimit = 1; // Free plan default
        if (user.activeSubscription) {
            const Subscription = require('../models/Subscription');
            const Plan = require('../models/Plan');
            const sub = await Subscription.findById(user.activeSubscription).populate('planId').lean();
            if (sub && sub.status === 'active' && sub.expiryDate > new Date()) {
                deviceLimit = sub.planId?.deviceLimit || 1;
            }
        }

        if ((user.devices || []).length >= deviceLimit) {
            return res.status(403).json({ error: `Device limit reached (${deviceLimit}). Upgrade your plan for more devices.` });
        }

        // Add device if not already present
        if (!user.devices) user.devices = [];
        const existing = user.devices.map(d => String(d).toUpperCase());
        if (existing.includes(normalizedId)) {
            return res.status(400).json({ error: 'Device already added' });
        }

        user.devices.push(normalizedId);
        await user.save();

        res.json({ success: true, message: 'Device added', deviceId: normalizedId });
    } catch (e) {
        res.status(500).json({ error: 'Failed to add device' });
    }
});

// POST /api/parent/remove-device
router.post('/parent/remove-device', authenticateUser, checkAccountStatus, async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

        const normalizedId = String(deviceId).trim().toUpperCase();
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.devices = (user.devices || []).filter(d => String(d).toUpperCase() !== normalizedId);
        await user.save();

        res.json({ success: true, message: 'Device removed' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to remove device' });
    }
});

// GET /api/parent/devices
router.get('/parent/devices', authenticateUser, checkAccountStatus, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('devices').lean();
        res.json({ devices: user.devices || [] });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get devices' });
    }
});

module.exports = router;
