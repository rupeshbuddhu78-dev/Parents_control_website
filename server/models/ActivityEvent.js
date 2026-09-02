'use strict';

const { mongoose } = require('../config/db');

const ActivityEventSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, index: true },
    application: { type: String, default: 'Other' },
    packageName: { type: String, default: '' },
    actorName: { type: String, default: '' },
    action: { type: String, default: 'activity' },
    message: { type: String, default: '' },
    text: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
    eventId: { type: String, required: true }
}, { collection: 'activity_events' });

ActivityEventSchema.index({ deviceId: 1, eventId: 1 }, { unique: true });
ActivityEventSchema.index({ deviceId: 1, timestamp: -1 });

const ActivityEvent = mongoose.models.ActivityEvent || mongoose.model('ActivityEvent', ActivityEventSchema);

module.exports = ActivityEvent;
