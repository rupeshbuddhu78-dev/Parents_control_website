'use strict';

/**
 * Admin seed script - creates the single ADMIN account.
 * Run with: node server/scripts/seedAdmin.js
 * Required env: ADMIN_EMAIL, ADMIN_PASSWORD, MONGODB_URI
 */

const env = require('../config/env');
const db = require('../config/db');
const User = require('../models/User');

async function seedAdmin() {
    try {
        await db.connect();

        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
            console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment');
            process.exit(1);
        }

        // Check if any admin already exists
        const existingAdmin = await User.findOne({ role: 'ADMIN' });
        if (existingAdmin) {
            console.log('Admin account already exists:', existingAdmin.email);
            console.log('To change admin password, update the database directly.');
            process.exit(0);
        }

        // Create admin
        const admin = await User.create({
            email: env.ADMIN_EMAIL.toLowerCase().trim(),
            name: env.ADMIN_NAME || 'Admin',
            password: env.ADMIN_PASSWORD,
            role: 'ADMIN',
            status: 'active',
            emailVerified: true,
        });

        console.log('Admin account created successfully:', admin.email);
        process.exit(0);
    } catch (e) {
        console.error('Admin seed failed:', e.message);
        process.exit(1);
    }
}

seedAdmin();
