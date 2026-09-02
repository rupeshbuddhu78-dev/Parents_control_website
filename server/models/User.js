'use strict';

const { mongoose } = require('../config/db');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    password: { type: String, required: true, minlength: 8 },
    role: { type: String, enum: ['PARENT', 'ADMIN'], default: 'PARENT', index: true },
    status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active', index: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null },
    emailVerificationExpires: { type: Date, default: null },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
    lastLogin: { type: Date, default: null },
    registeredAt: { type: Date, default: Date.now },
    // Device ownership: array of device IDs owned by this parent
    devices: [{ type: String, uppercase: true, trim: true }],
    // Subscription reference
    activeSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    // Suspended info
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: String, default: null },
    suspendReason: { type: String, default: null },
}, { collection: 'users', timestamps: true });

// Hash password before save
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) { next(err); }
});

// Compare password
UserSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive fields for JSON output
UserSchema.methods.toSafeJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    delete obj.emailVerificationToken;
    delete obj.emailVerificationExpires;
    delete obj.passwordResetToken;
    delete obj.passwordResetExpires;
    return obj;
};

// Indexes
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ email: 1, role: 1 });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

module.exports = User;
