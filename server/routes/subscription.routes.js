'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subscription.controller');
const { authenticateUser, requireAdmin, requireParent, checkAccountStatus } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');

// Public routes
router.get('/plans', ctrl.getPlans);

// Parent subscription routes
router.get('/subscription/status', authenticateUser, checkAccountStatus, ctrl.getSubscriptionStatus);
router.post('/payment/create-order', authenticateUser, checkAccountStatus, paymentLimiter, ctrl.createPaymentOrder);
router.post('/payment/verify', authenticateUser, checkAccountStatus, paymentLimiter, ctrl.verifyPayment);

// Cashfree webhook (no auth - uses signature verification)
router.post('/payment/webhook/cashfree', ctrl.cashfreeWebhook);

// Admin plan management
router.get('/admin/plans', authenticateUser, requireAdmin, ctrl.adminGetPlans);
router.post('/admin/plans', authenticateUser, requireAdmin, ctrl.adminCreatePlan);
router.put('/admin/plans/:id', authenticateUser, requireAdmin, ctrl.adminUpdatePlan);
router.post('/admin/plans/:id/toggle', authenticateUser, requireAdmin, ctrl.adminTogglePlan);

module.exports = router;
