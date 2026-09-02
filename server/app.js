'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const constants = require('./config/constants');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

function createApp() {
    const app = express();

    // ─── Trust Proxy (Required for Render/Heroku/Cloudflare) ────
    // Required by express-rate-limit to correctly identify users behind reverse proxy
    app.set('trust proxy', 1);

    // Ensure uploads directory exists
    const UPLOADS_DIR = path.join(__dirname, 'uploads');
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

    // ─── Security Headers ────────────────────────────────────────
    app.use(helmet({
        contentSecurityPolicy: false, // Allow inline scripts for existing HTML pages
        crossOriginEmbedderPolicy: false,
    }));

    // ─── CORS ────────────────────────────────────────────────────
    const allowedOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
        : ['*']; // In production, set CORS_ORIGINS env var

    app.use(cors({
        origin: allowedOrigins.includes('*') ? true : (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    }));

    // ─── Compression & Logging ───────────────────────────────────
    app.use(compression());
    app.use(requestLogger);

    // ─── Rate Limiting (general) ─────────────────────────────────
    app.use('/api/', apiLimiter);

    // Static uploads directory
    app.use('/uploads', express.static(UPLOADS_DIR));

    // ─── Raw Binary Upload Routes (MUST be before JSON body parser) ───
    const uploadCtrl = require('./controllers/upload.controller');
    app.post('/api/upload-storage-file', express.raw({ type: '*/*', limit: '120mb' }), uploadCtrl.uploadStorageFile);

    // ─── Body Parsers ────────────────────────────────────────────
    app.use(bodyParser.json({
        limit: constants.MAX_BODY_SIZE,
        verify: (req, res, buffer) => {
            if (req.originalUrl === '/api/payment/webhook/cashfree') {
                req.rawBody = Buffer.from(buffer);
            }
        },
    }));
    app.use(bodyParser.urlencoded({ limit: constants.MAX_BODY_SIZE, extended: true }));

    // Serve frontend HTML files from parent directory
    app.use(express.static(path.join(__dirname, '..', 'parent')));
    // Also serve from server directory itself for backward compatibility
    app.use(express.static(__dirname));

    // ─── Google OAuth Callback ──────────────────────────────────
    // Serve login page for OAuth callback (hash fragment handled by JS)
    app.get('/auth/google/callback', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'parent', 'login.html'));
    });

    // ─── Clean URLs (without .html extension) ───────────────────
    // Maps /login to /login.html, /dashboard to /dashboard.html, etc.
    app.get('*', (req, res, next) => {
        // Skip API routes and static files
        if (req.path.startsWith('/api/') || req.path.includes('.')) {
            return next();
        }

        // Try to serve .html version
        const htmlPath = path.join(__dirname, '..', 'parent', req.path + '.html');
        if (fs.existsSync(htmlPath)) {
            return res.sendFile(htmlPath);
        }

        next();
    });

    // Centralized error handler (must be last)
    app.use(errorHandler);

    return app;
}

module.exports = createApp;
