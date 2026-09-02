'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gallery.controller');

module.exports = function (io) {
    router.get('/gallery-fallback-list/:device_id', ctrl.galleryFallbackList);
    router.get('/gallery-list/:device_id', ctrl.galleryList);
    router.post('/upload-gallery-fallback', (req, res) => ctrl.uploadGalleryFallback(req, res, io));
    router.post('/delete-gallery-fallback', ctrl.deleteGalleryFallback);
    router.get('/screenshots-list/:device_id', ctrl.screenshotsList);
    router.get('/camera-list/:device_id', ctrl.cameraList);
    return router;
};
