'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');

/**
 * Authenticate parent/admin user via JWT access token.
 * Attaches req.user with { _id, email, role, status }.
 */
function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    if (!token) return res.status(401).json({ error: 'Token missing' });

    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        // Attach minimal user info; full lookup done if needed
        req.user = {
            _id: decoded.sub,
            email: decoded.email,
            role: decoded.role,
            status: decoded.status || 'active',
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

/**
 * Require the authenticated user to be an ADMIN.
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

/**
 * Require the authenticated user to be a PARENT (not admin).
 */
function requireParent(req, res, next) {
    if (!req.user || req.user.role !== 'PARENT') {
        return res.status(403).json({ error: 'Parent access required' });
    }
    next();
}

/**
 * Check that the user account is active (not suspended/banned).
 */
async function checkAccountStatus(req, res, next) {
    if (!req.user || !req.user._id) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const user = await User.findById(req.user._id).select('status').lean();
        if (!user) return res.status(401).json({ error: 'Account not found' });
        if (user.status === 'suspended') {
            return res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
        }
        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Account banned', code: 'ACCOUNT_BANNED' });
        }
        req.user.status = user.status;
        next();
    } catch (e) {
        return res.status(500).json({ error: 'Account check failed' });
    }
}

/**
 * Optional auth - attaches user if token present, but doesn't reject if missing.
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = {
            _id: decoded.sub,
            email: decoded.email,
            role: decoded.role,
            status: decoded.status || 'active',
        };
    } catch (err) {
        // Token invalid/expired - just continue without user
    }
    next();
}

/**
 * Check if user has active premium subscription.
 * Attaches req.hasPremium (boolean) and req.subscription (if active).
 * Does NOT reject - use for feature gating, not access control.
 */
async function checkPremiumAccess(req, res, next) {
    if (!req.user || !req.user._id) {
        req.hasPremium = false;
        return next();
    }
    
    try {
        const Subscription = require('../models/Subscription');
        const User = require('../models/User');
        
        const user = await User.findById(req.user._id).select('activeSubscription').lean();
        if (!user || !user.activeSubscription) {
            req.hasPremium = false;
            return next();
        }
        
        const subscription = await Subscription.findById(user.activeSubscription)
            .populate('planId')
            .lean();
        
        if (!subscription || subscription.status !== 'active') {
            req.hasPremium = false;
            return next();
        }
        
        // Check if expired
        if (subscription.expiryDate < new Date()) {
            // Mark as expired
            await Subscription.findByIdAndUpdate(subscription._id, { status: 'expired' });
            req.hasPremium = false;
            return next();
        }
        
        req.hasPremium = true;
        req.subscription = subscription;
        next();
    } catch (e) {
        req.hasPremium = false;
        next();
    }
}

module.exports = {
    authenticateUser,
    requireAdmin,
    requireParent,
    checkAccountStatus,
    optionalAuth,
    checkPremiumAccess,
};
