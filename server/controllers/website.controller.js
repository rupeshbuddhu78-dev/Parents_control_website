'use strict';

const fs = require('fs');
const path = require('path');

function getUploadsDir() {
    return path.join(__dirname, '..', 'uploads');
}

// GET /api/websites/:device_id
function getWebsites(req, res) {
    const filePath = path.join(getUploadsDir(), `${req.params.device_id.toUpperCase()}_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
}

// GET /api/blocked_websites/:device_id
function getBlockedWebsites(req, res) {
    const filePath = path.join(getUploadsDir(), `${req.params.device_id.toUpperCase()}_blocked_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
}

// POST /api/blocked_websites/:device_id
async function postBlockedWebsites(req, res, io) {
    const id = req.params.device_id.toUpperCase();
    const filePath = path.join(getUploadsDir(), `${id}_blocked_websites.json`);
    try {
        const { websites } = req.body;
        await fs.promises.writeFile(filePath, JSON.stringify(Array.isArray(websites) ? websites : [], null, 2));
        io.to(id).emit('command', 'block_url:' + JSON.stringify(websites));
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
}

// POST /api/whitelist_websites/:device_id
async function postWhitelistWebsites(req, res, io) {
    const id = req.params.device_id.toUpperCase();
    const filePath = path.join(getUploadsDir(), `${id}_whitelist_websites.json`);
    try {
        const { websites } = req.body;
        await fs.promises.writeFile(filePath, JSON.stringify(Array.isArray(websites) ? websites : [], null, 2));
        io.to(id).emit('command', 'whitelist_url:' + JSON.stringify(websites));
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
}

// GET /api/whitelist_websites/:device_id
function getWhitelistWebsites(req, res) {
    const filePath = path.join(getUploadsDir(), `${req.params.device_id.toUpperCase()}_whitelist_websites.json`);
    try {
        if (fs.existsSync(filePath)) { fs.createReadStream(filePath).pipe(res); } else { res.json([]); }
    } catch (e) { res.json([]); }
}

module.exports = { getWebsites, getBlockedWebsites, postBlockedWebsites, postWhitelistWebsites, getWhitelistWebsites };
