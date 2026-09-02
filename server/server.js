'use strict';

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;
const createApp = require('./app');
const env = require('./config/env');
const constants = require('./config/constants');
const db = require('./config/db');
const registerRoutes = require('./routes');
const { registerAll: registerSockets } = require('./sockets');

// ─── Validate required env vars in production ───────────────────
const missingVars = env.validateRequired();
if (missingVars.length > 0) {
    console.error('FATAL: Missing required environment variables:', missingVars.join(', '));
    if (env.isProduction()) {
        process.exit(1);
    }
}

// ─── Cloudinary Config ──────────────────────────────────────────
cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET
});

// ─── Express App ────────────────────────────────────────────────
const app = createApp();
const server = http.createServer(app);

// ─── Socket.IO (single instance) with auth middleware ───────────
const io = new Server(server, {
    cors: {
        origin: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    maxHttpBufferSize: constants.SOCKET_MAX_BUFFER,
    pingTimeout: constants.SOCKET_PING_TIMEOUT,
    pingInterval: constants.SOCKET_PING_INTERVAL,
    transports: ['websocket', 'polling']
});

// ─── Socket.IO Authentication Middleware ─────────────────────────
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const { verifyDeviceOwnershipSync } = require('./middleware/deviceOwnership');

io.use(async (socket, next) => {
    try {
        // Check for parent/admin auth token
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        // Check for device auth
        const deviceId = socket.handshake.auth?.deviceId || socket.handshake.query?.deviceId;
        const deviceToken = socket.handshake.auth?.deviceToken || socket.handshake.query?.deviceToken;

        if (token) {
            // Parent/Admin authentication
            const decoded = jwt.verify(token, env.JWT_SECRET);
            const user = await User.findById(decoded.sub).select('status role email devices').lean();
            if (!user) return next(new Error('Account not found'));
            if (user.status !== 'active') return next(new Error('Account not active'));

            socket.user = {
                _id: user._id,
                email: user.email,
                role: user.role,
                devices: (user.devices || []).map(d => String(d).toUpperCase()),
            };
            socket.isParent = user.role === 'PARENT';
            socket.isAdmin = user.role === 'ADMIN';
            return next();
        }

        if (deviceId) {
            // Child device connection
            const normalizedId = String(deviceId).trim().toUpperCase();
            // For backward compatibility, allow device connections without token
            // but mark them as legacy
            socket.deviceId = normalizedId;
            socket.isDevice = true;
            socket.isLegacy = !deviceToken;
            return next();
        }

        // Allow anonymous connections for now (backward compatibility)
        // In strict mode, this would be rejected
        socket.isAnonymous = true;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return next(new Error('Token expired'));
        }
        // Allow connection but mark as unauthenticated
        socket.isAnonymous = true;
        next();
    }
});

// ─── Register the gallery fallback binary route (needs io reference) ─
const uploadCtrl = require('./controllers/upload.controller');
app.post('/api/upload-gallery-fallback-binary', express.raw({ type: '*/*', limit: '120mb' }), (req, res) => uploadCtrl.uploadGalleryFallbackBinary(req, res, io));

// ─── Register REST Routes (all other /api/* endpoints) ──────────
registerRoutes(app, io);

// ─── Register Socket Handlers ───────────────────────────────────
registerSockets(io);

// ─── Connect MongoDB & Start Server ─────────────────────────────
(async () => {
    try {
        await db.connect();
        console.log('✅ MongoDB connected successfully');
        
        // Repair the legacy webhook index before accepting new payment orders.
        // Older records stored an empty string, so a unique non-sparse index made
        // every order after the first one fail with E11000.
        try {
            const Payment = require('./models/Payment');
            const paymentsCollection = db.mongoose.connection.collection('payments');
            const indexes = await paymentsCollection.indexes();
            const webhookIndex = indexes.find((index) => index.name === 'webhookIdempotencyKey_1' || index.key?.webhookIdempotencyKey);
            if (webhookIndex && (!webhookIndex.unique || !webhookIndex.sparse)) {
                await paymentsCollection.dropIndex(webhookIndex.name);
            }
            await Payment.updateMany(
                { webhookIdempotencyKey: '' },
                { $unset: { webhookIdempotencyKey: 1 } }
            );
            await paymentsCollection.createIndex(
                { webhookIdempotencyKey: 1 },
                { unique: true, sparse: true, name: 'webhookIdempotencyKey_1' }
            );
            console.log('✅ Payment webhook idempotency index repaired');
        } catch (paymentIndexError) {
            console.error('⚠️  Payment index migration warning:', paymentIndexError.message);
        }

        // Auto-seed admin and plans on first deployment
        if (env.isProduction() || env.NODE_ENV === 'development') {
            try {
                const User = require('./models/User');
                const Plan = require('./models/Plan');
                
                // Check if admin exists
                const adminExists = await User.findOne({ role: 'ADMIN' });
                if (!adminExists && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
                    console.log('🔐 Creating admin account...');
                    await User.create({
                        email: env.ADMIN_EMAIL.toLowerCase().trim(),
                        name: env.ADMIN_NAME || 'Admin',
                        password: env.ADMIN_PASSWORD,
                        role: 'ADMIN',
                        status: 'active',
                        emailVerified: true,
                    });
                    console.log('✅ Admin account created:', env.ADMIN_EMAIL);
                } else if (adminExists) {
                    console.log('✅ Admin account already exists');
                }
                
                // Apply the current catalog on every deployment. Upserts update
                // prices and durations but never delete plans referenced by users.
                const defaultPlans = require('./config/defaultPlans');
                await Plan.updateMany(
                    { slug: { $in: ['quarterly'] } },
                    { $set: { isActive: false, updatedAt: new Date() } }
                );
                for (const planData of defaultPlans) {
                    await Plan.findOneAndUpdate(
                        { slug: planData.slug },
                        { $set: { ...planData, updatedAt: new Date() } },
                        { upsert: true, new: true, setDefaultsOnInsert: true }
                    );
                }
                console.log('✅ Subscription plans synchronized:', defaultPlans.map((plan) => `${plan.name} ₹${plan.price}`).join(', '));
            } catch (seedError) {
                console.error('⚠️  Auto-seed warning:', seedError.message);
            }
        }
    } catch (e) {
        console.error('❌ MongoDB connection failed:', e.message);
    }
})();

server.listen(env.PORT, () => {
    console.log(`SERVER RUNNING ON PORT ${env.PORT}`);
    console.log(`Environment: ${env.NODE_ENV}`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server, io };
