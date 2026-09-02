'use strict';

const { mongoose } = require('../config/db');

const SubscriptionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'pending', index: true },
    startDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true, index: true },
    cancelledAt: { type: Date, default: null },
    autoRenew: { type: Boolean, default: false },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'subscriptions' });

SubscriptionSchema.index({ userId: 1, status: 1 });

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', SubscriptionSchema);

module.exports = Subscription;
