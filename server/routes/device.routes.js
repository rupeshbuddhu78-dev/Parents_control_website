'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/device.controller');

module.exports = function () {
    router.get('/admin/all-devices', ctrl.getAllDevices);
    router.get('/device-status/:id', ctrl.getDeviceStatus);
    router.post('/status', ctrl.postStatus);
    return router;
};
