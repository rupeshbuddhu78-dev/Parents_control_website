'use strict';

const { mongoose } = require('../config/db');

const PlanSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    billingPeriod: { type: String, enum: ['free', 'weekly', 'custom', 'monthly', 'quarterly', 'half-yearly', 'yearly'], required: true },
    durationDays: { type: Number, required: true, min: 0 },
    deviceLimit: { type: Number, default: 1, min: 1 },
    features: { type: [String], default: [] },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    cashfreePlanId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'plans' });

const Plan = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);

module.exports = Plan;
