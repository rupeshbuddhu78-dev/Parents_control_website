'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/command.controller');

module.exports = function (io) {
    router.post('/send-command', (req, res) => ctrl.sendCommand(req, res, io));
    return router;
};
