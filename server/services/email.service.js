'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!env.SMTP_HOST) {
        console.warn('[EMAIL] SMTP not configured - emails will be logged to console');
        return null;
    }
    transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return transporter;
}

async function sendEmail({ to, subject, html, text }) {
    const transport = getTransporter();
    if (!transport) {
        console.log(`[EMAIL_CONSOLE] To: ${to} | Subject: ${subject} | Body: ${(text || html || '').slice(0, 200)}`);
        return { sent: false, reason: 'SMTP not configured' };
    }
    try {
        const result = await transport.sendMail({
            from: env.SMTP_FROM || env.SMTP_USER,
            to,
            subject,
            html: html || text,
            text: text || undefined,
        });
        return { sent: true, messageId: result.messageId };
    } catch (e) {
        console.error('[EMAIL_ERROR]', e.message);
        return { sent: false, reason: e.message };
    }
}

async function sendVerificationEmail(email, token) {
    const link = `${env.APP_URL}/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    return sendEmail({
        to: email,
        subject: 'Verify your email',
        html: `<h2>Email Verification</h2><p>Click the link below to verify your email:</p><p><a href="${link}">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
        text: `Verify your email: ${link}`,
    });
}

async function sendPasswordResetEmail(email, token) {
    const link = `${env.APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    return sendEmail({
        to: email,
        subject: 'Password Reset Request',
        html: `<h2>Password Reset</h2><p>Click the link below to reset your password:</p><p><a href="${link}">Reset Password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
        text: `Reset your password: ${link}`,
    });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
