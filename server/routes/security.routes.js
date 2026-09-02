'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/security.controller');

module.exports = function (io) {
    router.post('/clear-data', (req, res) => ctrl.clearData(req, res, io));
    router.get('/activity-events', ctrl.getActivityEvents);
    router.post('/wipe-device', (req, res) => ctrl.wipeDevice(req, res, io));
    router.post('/set-pin', (req, res) => ctrl.setPin(req, res, io));
    return router;
};
