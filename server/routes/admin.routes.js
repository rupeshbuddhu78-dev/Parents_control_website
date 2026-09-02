'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/admin.controller');
const { authenticateUser, requireAdmin, checkAccountStatus } = require('../middleware/auth');

// Admin routes - middleware scoped to /admin/* paths only
// This prevents requireAdmin from blocking non-admin routes like /api/parent/*
router.use('/admin', authenticateUser, requireAdmin, checkAccountStatus);

router.get('/admin/dashboard', ctrl.getDashboard);
router.get('/admin/parents', ctrl.getParents);
router.get('/admin/parents/:id', ctrl.getParentDetail);
router.post('/admin/parents/:id/suspend', ctrl.suspendParent);
router.post('/admin/parents/:id/unsuspend', ctrl.unsuspendParent);
router.post('/admin/parents/:id/force-logout', ctrl.forceLogout);
router.post('/admin/parents/:id/disable', ctrl.disableParent);
router.post('/admin/parents/:id/enable', ctrl.enableParent);
router.get('/admin/devices-managed', ctrl.getAllDevices);
router.get('/admin/audit-logs', ctrl.getAuditLogs);
router.get('/admin/subscriptions', ctrl.getSubscriptions);
router.get('/admin/payments', ctrl.getPayments);

module.exports = router;
