'use strict';

const authService = require('../services/auth.service');
const { authLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const { authenticateUser } = require('../middleware/auth');

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

// POST /api/auth/register
async function register(req, res) {
    try {
        const { email, name, password } = req.body;
        const result = await authService.registerParent({
            email, name, password,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || '',
        });
        res.status(201).json({ success: true, user: result, message: 'Registration successful. Please verify your email.' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

// POST /api/auth/login
async function login(req, res) {
    try {
        const { email, password } = req.body;
        const result = await authService.loginUser({
            email, password,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
}

// POST /api/auth/refresh
async function refresh(req, res) {
    try {
        const { refreshToken } = req.body;
        const result = await authService.refreshAccessToken({
            refreshTokenValue: refreshToken,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
}

// POST /api/auth/logout
async function logout(req, res) {
    try {
        const { refreshToken } = req.body;
        if (req.user && req.user._id) {
            await authService.logoutUser({ refreshTokenValue: refreshToken, userId: req.user._id });
        }
        res.json({ success: true, message: 'Logged out' });
    } catch (e) {
        res.status(500).json({ error: 'Logout failed' });
    }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        const result = await authService.requestPasswordReset({ email, ip: getClientIp(req) });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

// POST /api/auth/reset-password
async function resetPassword(req, res) {
    try {
        const { token, email, newPassword } = req.body;
        const result = await authService.resetPassword({ token, email, newPassword, ip: getClientIp(req) });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

// POST /api/auth/verify-email
async function verifyEmail(req, res) {
    try {
        const { token, email } = req.body;
        const result = await authService.verifyEmail({ token, email });
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

// GET /api/auth/me
async function getMe(req, res) {
    try {
        const User = require('../models/User');
        const user = await User.findById(req.user._id).select('-password -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get user' });
    }
}

// POST /api/auth/google
async function googleLogin(req, res) {
    try {
        const { token, email, name, picture } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email required from Google' });
        }

        const User = require('../models/User');
        const crypto = require('crypto');
        
        // Check if user exists
        let user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            // Create new user with Google (no password needed)
            const randomPassword = crypto.randomBytes(32).toString('hex');
            user = await User.create({
                email: email.toLowerCase(),
                name: name || email.split('@')[0],
                password: randomPassword,
                role: 'PARENT',
                emailVerified: true, // Google verified the email
            });
        } else {
            // Update last login
            user.lastLogin = new Date();
            await user.save();
        }

        // Check account status
        if (user.status === 'suspended') {
            return res.status(403).json({ error: 'Account suspended. Contact support.' });
        }
        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Account banned.' });
        }

        // Generate tokens
        const authService = require('../services/auth.service');
        const accessToken = authService.generateAccessToken(user);
        const RefreshToken = require('../models/RefreshToken');
        const env = require('../config/env');
        const refreshTokenValue = RefreshToken.generateToken();
        const familyId = crypto.randomBytes(16).toString('hex');

        await RefreshToken.create({
            token: refreshTokenValue,
            userId: user._id,
            familyId,
            expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
            userAgent: req.headers['user-agent'] || '',
            ip: getClientIp(req),
        });

        // Log the action
        const auditService = require('../services/audit.service');
        await auditService.logAction({
            action: 'GOOGLE_LOGIN',
            actorId: user._id,
            actorEmail: user.email,
            actorRole: user.role,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || '',
        });

        res.json({
            success: true,
            user: user.toSafeJSON(),
            accessToken,
            refreshToken: refreshTokenValue,
        });
    } catch (e) {
        console.error('[GOOGLE_LOGIN_ERROR]', e.message);
        res.status(500).json({ error: 'Google login failed' });
    }
}

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, verifyEmail, getMe, googleLogin };
