'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/boot.controller');

module.exports = function (io) {
    router.post('/boot-status', (req, res) => ctrl.postBootStatus(req, res, io));
    router.get('/boot-events/:deviceId', ctrl.getBootEvents);
    router.get('/boot-status/:deviceId', ctrl.getBootStatus);
    return router;
};
