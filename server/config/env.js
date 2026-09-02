'use strict';

const requiredInProduction = ['MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

function getEnv(key, fallback) {
    const val = process.env[key];
    if (val !== undefined && val !== '') return val;
    if (fallback !== undefined) return fallback;
    return '';
}

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function validateRequired() {
    if (!isProduction()) return [];
    const missing = [];
    for (const key of requiredInProduction) {
        if (!process.env[key]) missing.push(key);
    }
    return missing;
}

module.exports = {
    PORT: getEnv('PORT', 3000),
    MONGODB_URI: getEnv('MONGODB_URI', ''),
    CLOUDINARY_CLOUD_NAME: getEnv('CLOUDINARY_CLOUD_NAME', getEnv('CLOUDINARY_NAME', '')),
    CLOUDINARY_API_KEY: getEnv('CLOUDINARY_API_KEY', getEnv('CLOUDINARY_KEY', '')),
    CLOUDINARY_API_SECRET: getEnv('CLOUDINARY_API_SECRET', getEnv('CLOUDINARY_SECRET', '')),

    // JWT
    JWT_SECRET: getEnv('JWT_SECRET', ''),
    JWT_REFRESH_SECRET: getEnv('JWT_REFRESH_SECRET', ''),
    JWT_ACCESS_EXPIRY: getEnv('JWT_ACCESS_EXPIRY', '15m'),
    JWT_REFRESH_EXPIRY_DAYS: parseInt(getEnv('JWT_REFRESH_EXPIRY_DAYS', '30'), 10),

    // Admin seed
    ADMIN_EMAIL: getEnv('ADMIN_EMAIL', ''),
    ADMIN_PASSWORD: getEnv('ADMIN_PASSWORD', ''),
    ADMIN_NAME: getEnv('ADMIN_NAME', 'Admin'),

    // App
    APP_URL: getEnv('APP_URL', 'http://localhost:3000'),
    NODE_ENV: getEnv('NODE_ENV', 'development'),

    // SMTP
    SMTP_HOST: getEnv('SMTP_HOST', ''),
    SMTP_PORT: parseInt(getEnv('SMTP_PORT', '587'), 10),
    SMTP_USER: getEnv('SMTP_USER', ''),
    SMTP_PASS: getEnv('SMTP_PASS', ''),
    SMTP_FROM: getEnv('SMTP_FROM', ''),

    // Google OAuth
    GOOGLE_CLIENT_ID: getEnv('GOOGLE_CLIENT_ID', ''),
    GOOGLE_CLIENT_SECRET: getEnv('GOOGLE_CLIENT_SECRET', ''),

    // Cashfree
    CASHFREE_APP_ID: getEnv('CASHFREE_APP_ID', ''),
    CASHFREE_SECRET_KEY: getEnv('CASHFREE_SECRET_KEY', ''),
    CASHFREE_ENV: getEnv('CASHFREE_ENV', 'sandbox'), // sandbox or production
    CASHFREE_WEBHOOK_SECRET: getEnv('CASHFREE_WEBHOOK_SECRET', ''),
    // Optional backup channel; browser server-side verification remains primary.
    CASHFREE_WEBHOOK_ENABLED: getEnv('CASHFREE_WEBHOOK_ENABLED', 'false'),
    CASHFREE_API_VERSION: getEnv('CASHFREE_API_VERSION', '2022-09-01'),

    // Helpers
    isProduction,
    validateRequired,
};
