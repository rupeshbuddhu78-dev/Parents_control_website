'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/upload.controller');

module.exports = function (io) {
    // NOTE: /api/upload-storage-file and /api/upload-gallery-fallback-binary
    // are registered in app.js/server.js BEFORE the JSON body parser.

    // Base64 uploads
    router.post('/upload-image', (req, res) => ctrl.uploadImage(req, res, io));
    router.post('/upload-audio', (req, res) => ctrl.uploadAudio(req, res, io));
    router.get('/audio-history/:device_id', ctrl.audioHistory);

    // Data upload / retrieve
    router.post('/upload_data', (req, res) => ctrl.uploadData(req, res, io));
    router.get('/get-data/:device_id/:type', ctrl.getData);

    // Folder listing
    router.get('/folder-list/:device_id/:folder', ctrl.folderList);

    return router;
};
