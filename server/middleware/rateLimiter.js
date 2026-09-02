'use strict';

const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: {
        xForwardedForHeader: false, // Disable validation - trust proxy handles this
    },
});

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
});

// Limiter for password reset
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { error: 'Too many password reset attempts' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limiter for registration
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many registration attempts' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limiter for payment endpoints
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many payment requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Device API limiter (for child app endpoints)
const deviceApiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 200,
    message: { error: 'Device rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    apiLimiter,
    authLimiter,
    passwordResetLimiter,
    registerLimiter,
    paymentLimiter,
    deviceApiLimiter,
};
