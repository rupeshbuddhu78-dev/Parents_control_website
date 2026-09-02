'use strict';

const crypto = require('crypto');
const dbService = require('../services/database.service');
const { generateEventKey } = require('../utils/helpers');

// In-memory latest boot health per device
const latestBootHealth = Object.create(null);

// POST /api/boot-status
async function postBootStatus(req, res, io) {
    try {
        let { device_id, deviceId, boot_session_id, bootSessionId, event_type, eventType,
            service_name, serviceName, status, message, timestamp } = req.body || {};
        const id = String(device_id || deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'device_id required' });

        const et = String(event_type || eventType || 'SERVICE_STATUS').trim();
        const st = String(status || 'SUCCESS').trim().toUpperCase();
        const svc = String(service_name || serviceName || '').trim();
        const msg = String(message || '').trim();
        const session = String(boot_session_id || bootSessionId || '').trim();
        const ts = Number(timestamp) || Date.now();

        const eventKey = generateEventKey(id, session, svc, et, st);

        const payload = {
            device_id: id, boot_session_id: session,
            event_type: et, service_name: svc,
            status: st, message: msg,
            timestamp: ts, eventKey
        };

        try {
            await dbService.saveBootStatus(id, {
                bootSessionId: session, eventType: et, serviceName: svc,
                status: st, message: msg, eventKey, timestamp: ts
            });
        } catch (e) { }

        if (!latestBootHealth[id]) {
            latestBootHealth[id] = { device_id: id, events: [], overall: null };
        }
        const entry = latestBootHealth[id];
        if (entry.boot_session_id && entry.boot_session_id !== session) {
            entry.events = [];
        }
        entry.boot_session_id = session;
        entry.lastEvent = payload;
        entry.updatedAt = ts;
        if (!entry.events.some(e => e.eventKey === eventKey)) {
            entry.events.push(payload);
            if (entry.events.length > 40) entry.events = entry.events.slice(-40);
        }
        if (et === 'BOOT_COMPLETE') {
            entry.overall = { status: st, message: msg, boot_session_id: session, timestamp: ts };
        }

        if (st === 'ERROR' || st === 'WARNING' || et === 'BOOT_COMPLETE') {
            try { io.to(id).emit('boot_status', payload); } catch (e) { }
        }

        res.json({ status: 'ok', eventKey });
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
}

// GET /api/boot-events/:deviceId
async function getBootEvents(req, res) {
    try {
        const id = String(req.params.deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const events = await dbService.loadAllBootEvents(id, limit);
        res.json(Array.isArray(events) ? events : []);
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
}

// GET /api/boot-status/:deviceId
async function getBootStatus(req, res) {
    try {
        const id = String(req.params.deviceId || '').trim().toUpperCase();
        if (!id) return res.status(400).json({ error: 'deviceId required' });
        if (latestBootHealth[id] && latestBootHealth[id].overall) {
            return res.json({
                device_id: id,
                boot_session_id: latestBootHealth[id].boot_session_id,
                overall: latestBootHealth[id].overall,
                lastEvent: latestBootHealth[id].lastEvent,
                events: latestBootHealth[id].events || []
            });
        }
        const row = await dbService.loadLatestBootStatus(id);
        if (!row) return res.json({ device_id: id, overall: null });
        return res.json({
            device_id: id,
            boot_session_id: row.bootSessionId,
            overall: {
                status: row.status, message: row.message,
                boot_session_id: row.bootSessionId, timestamp: row.timestamp
            },
            lastEvent: {
                device_id: id, boot_session_id: row.bootSessionId,
                event_type: row.eventType, service_name: row.serviceName,
                status: row.status, message: row.message, timestamp: row.timestamp
            },
            events: []
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'failed' });
    }
}

module.exports = { postBootStatus, getBootEvents, getBootStatus };
