'use strict';

const { mongoose } = require('../config/db');

const PaymentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    orderId: { type: String, required: true, unique: true, index: true },
    paymentId: { type: String, default: null, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: {
        type: String,
        enum: ['created', 'pending', 'success', 'failed', 'expired', 'refunded'],
        default: 'created',
        index: true
    },
    paymentMethod: { type: String, default: '' },
    cashfreeResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
    webhookReceived: { type: Boolean, default: false },
    // Optional because normal order creation happens before a webhook exists.
    // Sparse uniqueness prevents multiple orders with no webhook key from colliding.
    webhookIdempotencyKey: { type: String, default: undefined },
    webhookData: { type: mongoose.Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: '' },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    // Used to make browser verification and webhook delivery idempotent.
    activationInProgress: { type: Boolean, default: false },
    activationStartedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'payments' });

PaymentSchema.index({ userId: 1, createdAt: -1 });
PaymentSchema.index({ orderId: 1, status: 1 });
PaymentSchema.index(
    { webhookIdempotencyKey: 1 },
    { unique: true, sparse: true, name: 'webhookIdempotencyKey_1' }
);

PaymentSchema.pre('save', function updateTimestamp(next) {
    this.updatedAt = new Date();
    next();
});

const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

module.exports = Payment;
