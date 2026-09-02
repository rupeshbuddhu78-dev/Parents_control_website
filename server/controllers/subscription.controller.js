'use strict';

const crypto = require('crypto');
const https = require('https');
const env = require('../config/env');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const User = require('../models/User');
const auditService = require('../services/audit.service');

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

// Get Cashfree base URL
function getCashfreeBaseUrl() {
    return env.CASHFREE_ENV === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
}

// Get Cashfree headers with correct API version
function getCashfreeHeaders() {
    return {
        'x-api-version': env.CASHFREE_API_VERSION || '2022-09-01',
        'x-client-id': env.CASHFREE_APP_ID,
        'x-client-secret': env.CASHFREE_SECRET_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
}

// Prefer an explicitly configured public URL, but never send Cashfree back to
// localhost when the app is deployed behind a proxy or hosting platform.
function getPublicAppUrl(req) {
    const configuredUrl = String(env.APP_URL || '').trim().replace(/\/+$/, '');
    const isLocalUrl = /^https?:\/\/(localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(configuredUrl);
    if (configuredUrl && !isLocalUrl) return configuredUrl;

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    return `${protocol}://${req.get('host')}`;
}

// Helper: Make HTTPS request
function makeRequest(url, method, body = null) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: method,
            headers: getCashfreeHeaders(),
        };
        
        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: { raw: data } });
                }
            });
        });
        
        req.on('error', reject);
        
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

// GET /api/plans - public
async function getPlans(req, res) {
    try {
        const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).lean();
        res.json({ plans });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get plans' });
    }
}

// GET /api/subscription/status - for authenticated parent
async function getSubscriptionStatus(req, res) {
    try {
        const user = await User.findById(req.user._id).populate('activeSubscription').lean();
        if (!user || !user.activeSubscription) {
            return res.json({ hasActiveSubscription: false, subscription: null });
        }
        const sub = await Subscription.findById(user.activeSubscription._id || user.activeSubscription)
            .populate('planId')
            .lean();
        if (!sub || sub.status !== 'active' || sub.expiryDate < new Date()) {
            // Mark as expired if past expiry date
            if (sub && sub.expiryDate < new Date() && sub.status === 'active') {
                await Subscription.findByIdAndUpdate(sub._id, { status: 'expired' });
            }
            return res.json({ hasActiveSubscription: false, subscription: sub });
        }
        res.json({ hasActiveSubscription: true, subscription: sub });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get subscription status' });
    }
}

// POST /api/payment/create-order
async function createPaymentOrder(req, res) {
    try {
        const { planId } = req.body;
        if (!planId) return res.status(400).json({ error: 'Plan ID required' });

        const plan = await Plan.findById(planId);
        if (!plan || !plan.isActive) return res.status(404).json({ error: 'Plan not found or inactive' });

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Create unique order ID
        const orderId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        // Create payment record
        const payment = await Payment.create({
            userId: user._id,
            planId: plan._id,
            orderId,
            amount: plan.price,
            currency: plan.currency,
            status: 'created',
        });

        console.log('[PAYMENT] Creating order:', orderId, 'Amount:', plan.price, plan.currency);

        // Check if Cashfree is configured
        if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
            const errorMessage = 'Payment gateway not configured. Please contact admin.';
            console.error('[PAYMENT] Cashfree not configured - missing CASHFREE_APP_ID or CASHFREE_SECRET_KEY');
            payment.status = 'failed';
            payment.errorMessage = errorMessage;
            await payment.save();
            return res.status(502).json({ 
                success: false, 
                error: errorMessage
            });
        }

        // Create order with Cashfree
        try {
            const orderMeta = {
                return_url: `${getPublicAppUrl(req)}/payment-verify.html?order_id=${encodeURIComponent(orderId)}`,
            };
            // Webhooks are an optional backup. Browser verification below is
            // sufficient for activation when CASHFREE_WEBHOOK_ENABLED=false.
            if (String(env.CASHFREE_WEBHOOK_ENABLED || 'false').toLowerCase() === 'true') {
                orderMeta.notify_url = `${getPublicAppUrl(req)}/api/payment/webhook/cashfree`;
            }

            const requestBody = JSON.stringify({
                order_id: orderId,
                order_amount: plan.price,
                order_currency: plan.currency,
                customer_details: {
                    customer_id: String(user._id),
                    customer_email: user.email,
                    customer_name: user.name || user.email.split('@')[0],
                    customer_phone: user.phone || '9999999999', // Required by Cashfree
                },
                order_meta: orderMeta,
            });

            console.log('[PAYMENT] Cashfree environment:', env.CASHFREE_ENV);
            console.log('[PAYMENT] API version:', env.CASHFREE_API_VERSION || '2022-09-01');
            console.log('[PAYMENT] Base URL:', getCashfreeBaseUrl());
            console.log('[PAYMENT] Request body:', requestBody);

            const response = await makeRequest(
                getCashfreeBaseUrl() + '/orders',
                'POST',
                requestBody
            );

            console.log('[PAYMENT] Cashfree response status:', response.statusCode);
            console.log('[PAYMENT] Cashfree response:', JSON.stringify(response.data));

            // Check if request was successful
            if (response.statusCode < 200 || response.statusCode >= 300) {
                console.error('[PAYMENT] Cashfree API error:', JSON.stringify(response.data));
                payment.status = 'failed';
                payment.errorMessage = `Cashfree API error: ${response.statusCode}`;
                payment.cashfreeResponse = response.data;
                await payment.save();

                return res.status(502).json({
                    success: false,
                    error: 'Unable to create payment order',
                    details: response.data.message || 'Cashfree API returned error',
                });
            }

            // Check if payment_session_id exists
            if (!response.data.payment_session_id) {
                console.error('[PAYMENT] No payment_session_id in response:', JSON.stringify(response.data));
                payment.status = 'failed';
                payment.errorMessage = 'No payment session ID received from Cashfree';
                payment.cashfreeResponse = response.data;
                await payment.save();

                return res.status(502).json({
                    success: false,
                    error: 'Payment session creation failed',
                    details: 'No payment session ID received',
                });
            }

            // Save successful response
            payment.cashfreeResponse = response.data;
            payment.status = 'pending';
            payment.errorMessage = '';
            await payment.save();

            console.log('[PAYMENT] Order created successfully. Payment session ID:', response.data.payment_session_id);

            return res.json({
                success: true,
                orderId,
                paymentSessionId: response.data.payment_session_id,
                amount: plan.price,
                currency: plan.currency,
                planName: plan.name,
                cashfreeEnv: env.CASHFREE_ENV || 'sandbox',
            });

        } catch (cashfreeErr) {
            console.error('[PAYMENT] Cashfree request failed:', cashfreeErr.message);
            payment.status = 'failed';
            payment.errorMessage = cashfreeErr.message;
            payment.updatedAt = new Date();
            await payment.save();

            return res.status(502).json({
                success: false,
                error: 'Payment gateway error',
                details: cashfreeErr.message,
            });
        }

    } catch (e) {
        console.error('[PAYMENT] Create order error:', e.message);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
}

// POST /api/payment/verify
async function verifyPayment(req, res) {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ error: 'Order ID required' });

        const payment = await Payment.findOne({ orderId }).populate('planId');
        if (!payment) return res.status(404).json({ error: 'Payment not found' });

        // Verify ownership - only the user who created the payment can verify it
        if (String(payment.userId) !== String(req.user._id) && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Prevent duplicate processing
        if (payment.status === 'success') {
            const subscription = await Subscription.findById(payment.subscriptionId).lean();
            return res.json({ 
                success: true, 
                status: 'already_verified', 
                message: 'Payment already verified',
                planName: payment.planId?.name || 'Premium',
                amount: payment.amount,
                expiryDate: subscription?.expiryDate
            });
        }

        // Check if Cashfree is configured
        if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
            const errorMessage = 'Payment gateway not configured';
            console.error('[VERIFY] Cashfree not configured');
            payment.errorMessage = errorMessage;
            await payment.save();
            return res.status(502).json({ 
                success: false, 
                status: 'error',
                error: errorMessage
            });
        }

        // Verify with Cashfree
        try {
            console.log('[VERIFY] Checking order status with Cashfree:', orderId);

            const response = await makeRequest(
                getCashfreeBaseUrl() + '/orders/' + orderId,
                'GET'
            );

            console.log('[VERIFY] Cashfree response status:', response.statusCode);

            if (response.statusCode < 200 || response.statusCode >= 300) {
                console.error('[VERIFY] Cashfree API error:', JSON.stringify(response.data));
                payment.cashfreeResponse = response.data;
                payment.errorMessage = `Cashfree verification error: ${response.statusCode}`;
                await payment.save();
                return res.status(502).json({
                    success: false,
                    status: 'error',
                    error: 'Failed to verify payment with gateway',
                });
            }

            const orderStatus = response.data.order_status;
            console.log('[VERIFY] Order status:', orderStatus);

            if (orderStatus === 'PAID') {
                // Browser verification and the webhook may arrive together. The
                // activation helper claims the payment and is idempotent.
                const subscription = await activateSubscription(payment, response.data);
                if (!subscription) {
                    return res.json({
                        success: false,
                        status: 'pending',
                        message: 'Payment received. Your subscription is being activated; please check again shortly.'
                    });
                }

                console.log('[VERIFY] Subscription activated for order:', orderId);

                return res.json({ 
                    success: true, 
                    status: 'success', 
                    message: 'Payment verified and subscription activated',
                    planName: payment.planId?.name || 'Premium',
                    amount: payment.amount,
                    expiryDate: subscription.expiryDate
                });
            } else {
                // Update payment status
                payment.status = orderStatus === 'ACTIVE' ? 'pending' : 'failed';
                payment.cashfreeResponse = response.data;
                await payment.save();

                return res.json({ 
                    success: false, 
                    status: payment.status, 
                    message: orderStatus === 'ACTIVE' 
                        ? 'Payment is still pending' 
                        : `Payment ${orderStatus.toLowerCase()}`
                });
            }

        } catch (verifyErr) {
            console.error('[VERIFY] Cashfree verification failed:', verifyErr.message);
            payment.errorMessage = verifyErr.message;
            await payment.save();
            return res.status(502).json({
                success: false,
                status: 'error',
                error: 'Payment verification failed',
                details: verifyErr.message,
            });
        }

    } catch (e) {
        console.error('[VERIFY] Error:', e.message);
        res.status(500).json({ error: 'Verification failed' });
    }
}

// POST /api/payment/webhook/cashfree
async function cashfreeWebhook(req, res) {
    try {
        // Cashfree signs timestamp + raw JSON body. Never verify a re-serialized
        // object because whitespace/key ordering can differ from the signed payload.
        if (env.CASHFREE_WEBHOOK_SECRET) {
            const signature = req.headers['x-webhook-signature'];
            const timestamp = req.headers['x-webhook-timestamp'];
            const rawBody = Buffer.isBuffer(req.rawBody)
                ? req.rawBody
                : Buffer.from(JSON.stringify(req.body || {}));

            if (!signature || !timestamp) {
                console.error('[WEBHOOK] Missing signature or timestamp');
                return res.status(401).json({ error: 'Missing webhook signature' });
            }

            const signedPayload = `${timestamp}${rawBody.toString('utf8')}`;
            const expectedSig = crypto.createHmac('sha256', env.CASHFREE_WEBHOOK_SECRET)
                .update(signedPayload)
                .digest('base64');
            const received = Buffer.from(String(signature));
            const expected = Buffer.from(expectedSig);

            if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
                console.error('[WEBHOOK] Invalid signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        const { data } = req.body || {};
        if (!data || !data.order) {
            console.error('[WEBHOOK] Invalid webhook data');
            return res.status(400).json({ error: 'Invalid webhook data' });
        }

        const orderId = data.order.order_id;
        console.log('[WEBHOOK] Received webhook for order:', orderId, 'Status:', data.order.order_status);

        const payment = await Payment.findOne({ orderId });
        if (!payment) {
            console.error('[WEBHOOK] Payment not found for order:', orderId);
            return res.status(404).json({ error: 'Payment not found' });
        }

        const idempotencyKey = String(req.headers['x-idempotency-header'] || '');

        // Cashfree delivers webhooks at least once. A successful payment is
        // terminal; the same event must never create another subscription.
        if (payment.webhookReceived && payment.status === 'success') {
            console.log('[WEBHOOK] Already processed order:', orderId);
            return res.json({ success: true, message: 'Already processed' });
        }

        payment.webhookReceived = true;
        payment.webhookIdempotencyKey = idempotencyKey || payment.webhookIdempotencyKey;
        payment.webhookData = req.body;
        payment.cashfreeResponse = req.body;
        await payment.save();

        if (data.order.order_status === 'PAID') {
            payment.paymentId = data.payment?.payment_id || null;
            payment.paymentMethod = data.payment?.payment_method || '';
            await activateSubscription(payment, data);
            console.log('[WEBHOOK] Subscription activated for order:', orderId);
        } else if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(data.order.order_status)) {
            payment.status = data.order.order_status === 'FAILED' ? 'failed' : 'expired';
            payment.errorMessage = data.order.order_note || data.order.order_message || '';
            await payment.save();
            console.log('[WEBHOOK] Order', orderId, 'marked as', payment.status);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[WEBHOOK] Error:', e.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
}

// Activate subscription after successful payment.
// This is deliberately idempotent because Cashfree webhooks are delivered at
// least once and the browser may verify the same order at the same time.
async function activateSubscription(payment, cashfreeData) {
    const storedPayment = await Payment.findById(payment._id);
    if (!storedPayment) throw new Error(`Payment not found: ${payment.orderId}`);

    if (storedPayment.status === 'success' && storedPayment.subscriptionId) {
        console.log('[ACTIVATE] Subscription already activated for payment:', storedPayment.orderId);
        return Subscription.findById(storedPayment.subscriptionId).lean();
    }

    // Recover a payment whose subscription was created before the process was
    // interrupted while saving the payment link.
    const existingSubscription = await Subscription.findOne({ paymentId: storedPayment._id }).lean();
    if (existingSubscription) {
        storedPayment.status = 'success';
        storedPayment.subscriptionId = existingSubscription._id;
        storedPayment.activationInProgress = false;
        storedPayment.activationStartedAt = null;
        storedPayment.cashfreeResponse = cashfreeData || storedPayment.cashfreeResponse;
        await storedPayment.save();
        return existingSubscription;
    }

    const now = new Date();
    const staleClaimTime = new Date(now.getTime() - 5 * 60 * 1000);
    const claimedPayment = await Payment.findOneAndUpdate(
        {
            _id: storedPayment._id,
            status: { $ne: 'success' },
            $or: [
                { activationInProgress: { $ne: true } },
                { activationInProgress: true, activationStartedAt: null },
                { activationStartedAt: { $lt: staleClaimTime } },
            ],
        },
        {
            $set: {
                activationInProgress: true,
                activationStartedAt: now,
                cashfreeResponse: cashfreeData || storedPayment.cashfreeResponse,
            },
        },
        { new: true }
    );

    if (!claimedPayment) {
        const latestPayment = await Payment.findById(storedPayment._id).lean();
        if (latestPayment?.status === 'success' && latestPayment.subscriptionId) {
            return Subscription.findById(latestPayment.subscriptionId).lean();
        }
        // Another request is currently activating this payment. The caller can
        // safely show a pending state and retry without creating another record.
        return null;
    }

    try {
        const plan = await Plan.findById(claimedPayment.planId);
        if (!plan) throw new Error(`Plan not found for payment: ${claimedPayment.orderId}`);

        let startDate = now;
        let expiryDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

        // Extend a still-active subscription rather than discarding remaining time.
        const user = await User.findById(claimedPayment.userId);
        if (user && user.activeSubscription) {
            const currentSubscription = await Subscription.findById(user.activeSubscription);
            if (currentSubscription && currentSubscription.status === 'active' && currentSubscription.expiryDate > now) {
                startDate = currentSubscription.expiryDate;
                expiryDate = new Date(currentSubscription.expiryDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
                console.log('[ACTIVATE] Extending existing subscription from', currentSubscription.expiryDate, 'to', expiryDate);
            }
        }

        const subscription = await Subscription.create({
            userId: claimedPayment.userId,
            planId: plan._id,
            status: 'active',
            startDate,
            expiryDate,
            paymentId: claimedPayment._id,
        });

        claimedPayment.status = 'success';
        claimedPayment.subscriptionId = subscription._id;
        claimedPayment.activationInProgress = false;
        claimedPayment.activationStartedAt = null;
        claimedPayment.errorMessage = '';
        claimedPayment.cashfreeResponse = cashfreeData || claimedPayment.cashfreeResponse;
        await claimedPayment.save();

        await User.findByIdAndUpdate(claimedPayment.userId, { activeSubscription: subscription._id });

        console.log('[ACTIVATE] Created subscription:', subscription._id, 'Expires:', expiryDate);

        await auditService.logAction({
            action: 'SUBSCRIPTION_ACTIVATED',
            actorId: claimedPayment.userId,
            targetType: 'subscription',
            targetId: String(subscription._id),
            details: { planName: plan.name, orderId: claimedPayment.orderId, expiryDate },
        });

        return subscription.toObject();
    } catch (error) {
        claimedPayment.activationInProgress = false;
        claimedPayment.activationStartedAt = null;
        claimedPayment.errorMessage = error.message;
        await claimedPayment.save();
        throw error;
    }
}

// Admin: Manage plans
async function adminGetPlans(req, res) {
    try {
        const plans = await Plan.find({}).sort({ sortOrder: 1 }).lean();
        res.json({ plans });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get plans' });
    }
}

function normalizePlanSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeFeatures(features) {
    if (Array.isArray(features)) return features.map((feature) => String(feature).trim()).filter(Boolean);
    return String(features || '').split(',').map((feature) => feature.trim()).filter(Boolean);
}

function parsePlanValues(body, { requireName = false } = {}) {
    const name = String(body.name || '').trim();
    const slug = normalizePlanSlug(body.slug || name);
    const price = Number(body.price);
    const durationDays = Number(body.durationDays);
    const deviceLimit = Number(body.deviceLimit || 1);
    const billingPeriod = String(body.billingPeriod || 'custom').trim().toLowerCase();
    const validPeriods = ['free', 'weekly', 'custom', 'monthly', 'quarterly', 'half-yearly', 'yearly'];

    if ((requireName && !name) || !slug || !validPeriods.includes(billingPeriod)) {
        throw new Error('Name, slug, and a valid billing period are required');
    }
    if (!Number.isFinite(price) || price < 0) throw new Error('Price must be a non-negative number');
    if (!Number.isFinite(durationDays) || durationDays < 0) throw new Error('Duration must be a non-negative number of days');
    if (!Number.isInteger(deviceLimit) || deviceLimit < 1) throw new Error('Device limit must be a positive whole number');

    return {
        ...(name ? { name } : {}),
        slug,
        price,
        currency: String(body.currency || 'INR').trim().toUpperCase(),
        billingPeriod,
        durationDays,
        deviceLimit,
        features: normalizeFeatures(body.features),
        description: String(body.description || '').trim(),
        ...(body.isPopular !== undefined ? { isPopular: Boolean(body.isPopular) } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
    };
}

async function adminCreatePlan(req, res) {
    try {
        const values = parsePlanValues(req.body, { requireName: true });
        const plan = await Plan.create({ ...values, isActive: true });
        res.status(201).json({ success: true, plan });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

async function adminUpdatePlan(req, res) {
    try {
        const existing = await Plan.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Plan not found' });

        // Merge partial admin edits with the current document so an edit to a
        // price or duration cannot erase the plan’s features or slug.
        const values = parsePlanValues({ ...existing.toObject(), ...req.body }, { requireName: true });
        delete values.name;
        const plan = await Plan.findByIdAndUpdate(
            req.params.id,
            { $set: { ...values, updatedAt: new Date() } },
            { new: true, runValidators: true }
        );
        res.json({ success: true, plan });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
}

async function adminTogglePlan(req, res) {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });
        plan.isActive = !plan.isActive;
        await plan.save();
        res.json({ success: true, plan });
    } catch (e) {
        res.status(500).json({ error: 'Failed to toggle plan' });
    }
}

module.exports = {
    getPlans, getSubscriptionStatus,
    createPaymentOrder, verifyPayment, cashfreeWebhook,
    adminGetPlans, adminCreatePlan, adminUpdatePlan, adminTogglePlan,
};
