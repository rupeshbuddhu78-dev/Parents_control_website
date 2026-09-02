'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const { authenticateUser } = require('../middleware/auth');
const { authLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

// Public routes
router.post('/auth/register', registerLimiter, ctrl.register);
router.post('/auth/login', authLimiter, ctrl.login);
router.post('/auth/google', authLimiter, ctrl.googleLogin);
router.post('/auth/refresh', ctrl.refresh);
router.post('/auth/forgot-password', passwordResetLimiter, ctrl.forgotPassword);
router.post('/auth/reset-password', passwordResetLimiter, ctrl.resetPassword);
router.post('/auth/verify-email', ctrl.verifyEmail);

// Protected routes
router.get('/auth/me', authenticateUser, ctrl.getMe);
router.post('/auth/logout', authenticateUser, ctrl.logout);

module.exports = router;
