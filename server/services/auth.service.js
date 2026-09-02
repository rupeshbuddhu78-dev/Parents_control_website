'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const auditService = require('../services/audit.service');
const emailService = require('../services/email.service');

function generateAccessToken(user) {
    return jwt.sign(
        { sub: user._id, email: user.email, role: user.role, status: user.status },
        env.JWT_SECRET,
        { expiresIn: env.JWT_ACCESS_EXPIRY }
    );
}

function generateRefreshTokenValue() {
    return RefreshToken.generateToken();
}

async function registerParent({ email, name, password, ip, userAgent }) {
    // Validate
    if (!email || !name || !password) {
        throw new Error('Email, name, and password are required');
    }
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
        throw new Error('Email already registered');
    }

    // Create user (password hashed by pre-save hook)
    const user = await User.create({
        email: normalizedEmail,
        name: name.trim(),
        password,
        role: 'PARENT',
    });

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verifyToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Send verification email
    await emailService.sendVerificationEmail(user.email, verifyToken);

    await auditService.logAction({
        action: 'PARENT_REGISTERED',
        actorId: user._id,
        actorEmail: user.email,
        actorRole: 'PARENT',
        ip,
        userAgent,
    });

    return user.toSafeJSON();
}

async function loginUser({ email, password, ip, userAgent }) {
    if (!email || !password) {
        throw new Error('Email and password are required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        throw new Error('Invalid email or password');
    }

    if (user.status === 'suspended') {
        throw new Error('Account suspended. Contact support.');
    }
    if (user.status === 'banned') {
        throw new Error('Account banned.');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        throw new Error('Invalid email or password');
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshTokenValue = generateRefreshTokenValue();
    const familyId = crypto.randomBytes(16).toString('hex');

    await RefreshToken.create({
        token: refreshTokenValue,
        userId: user._id,
        familyId,
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        userAgent: userAgent || '',
        ip: ip || '',
    });

    await auditService.logAction({
        action: user.role === 'ADMIN' ? 'ADMIN_LOGIN' : 'PARENT_LOGIN',
        actorId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        ip,
        userAgent,
    });

    return {
        user: user.toSafeJSON(),
        accessToken,
        refreshToken: refreshTokenValue,
    };
}

async function refreshAccessToken({ refreshTokenValue, ip, userAgent }) {
    if (!refreshTokenValue) throw new Error('Refresh token required');

    const stored = await RefreshToken.findOne({ token: refreshTokenValue });
    if (!stored) throw new Error('Invalid refresh token');
    if (stored.isRevoked) throw new Error('Refresh token revoked');
    if (stored.expiresAt < new Date()) throw new Error('Refresh token expired');

    // Check user still exists and is active
    const user = await User.findById(stored.userId);
    if (!user) throw new Error('Account not found');
    if (user.status !== 'active') throw new Error('Account not active');

    // Rotate: revoke old token, issue new one
    stored.isRevoked = true;
    await stored.save();

    const newTokenValue = generateRefreshTokenValue();
    await RefreshToken.create({
        token: newTokenValue,
        userId: user._id,
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        userAgent: userAgent || '',
        ip: ip || '',
    });

    const accessToken = generateAccessToken(user);

    return {
        accessToken,
        refreshToken: newTokenValue,
    };
}

async function logoutUser({ refreshTokenValue, userId }) {
    if (refreshTokenValue) {
        await RefreshToken.updateOne({ token: refreshTokenValue }, { isRevoked: true });
    }
    // Revoke all tokens for this user (full logout)
    await RefreshToken.updateMany({ userId, isRevoked: false }, { isRevoked: true });
}

async function forceLogoutUser(userId) {
    await RefreshToken.updateMany({ userId, isRevoked: false }, { isRevoked: true });
}

async function requestPasswordReset({ email, ip }) {
    if (!email) throw new Error('Email required');
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        // Don't reveal if email exists
        return { sent: true, message: 'If the email exists, a reset link has been sent' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    await emailService.sendPasswordResetEmail(user.email, resetToken);

    await auditService.logAction({
        action: 'PASSWORD_RESET_REQUESTED',
        actorId: user._id,
        actorEmail: user.email,
        ip,
    });

    return { sent: true, message: 'If the email exists, a reset link has been sent' };
}

async function resetPassword({ token, email, newPassword, ip }) {
    if (!token || !email || !newPassword) throw new Error('Token, email, and new password required');
    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters');

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({
        email: normalizedEmail,
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
    });

    if (!user) throw new Error('Invalid or expired reset token');

    user.password = newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    // Revoke all refresh tokens
    await RefreshToken.updateMany({ userId: user._id, isRevoked: false }, { isRevoked: true });

    await auditService.logAction({
        action: 'PASSWORD_RESET_COMPLETED',
        actorId: user._id,
        actorEmail: user.email,
        ip,
    });

    return { success: true, message: 'Password reset successful' };
}

async function verifyEmail({ token, email }) {
    if (!token || !email) throw new Error('Token and email required');
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({
        email: normalizedEmail,
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() },
    });
    if (!user) throw new Error('Invalid or expired verification token');

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    return { success: true, message: 'Email verified successfully' };
}

module.exports = {
    registerParent,
    loginUser,
    refreshAccessToken,
    logoutUser,
    forceLogoutUser,
    requestPasswordReset,
    resetPassword,
    verifyEmail,
    generateAccessToken,
};
