const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * User WhatsApp Bot Model
 * Stores WhatsApp bot instances for multi-bot mode.
 * 1 user can create multiple bots (userId can have multiple records).
 * Auth session is stored separately in wa_auth_states collection.
 */
const userWhatsappBotSchema = new Schema({
    // Owner Information
    userId: {
        type: String,
        required: true,
        index: true
    },

    // WhatsApp phone number (international format without +, e.g. "6281234567890")
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Bot Display Name (optional, for company branding)
    botName: {
        type: String,
        required: false
    },

    // How this bot was paired
    pairingMethod: {
        type: String,
        enum: ['qr', 'code'],
        default: null
    },

    // Connection tracking
    lastConnectedAt: {
        type: Date,
        default: null
    },

    // Status Flags
    isActive: {
        type: Boolean,
        required: true,
        default: true,
        index: true
    },
    isSuspended: {
        type: Boolean,
        required: true,
        default: false
    },

    // Webhook URL for connection/message notifications (optional)
    webhook_url: {
        type: String,
        default: null
    },

    // Subscribed events for this bot's webhook. Use ["*"] for all events.
    webhook_events: {
        type: [String],
        default: ['*']
    },

    // HMAC-SHA256 secret for signing webhook payloads. Auto-generated when
    // webhook_url is first set; rotated whenever webhook_url changes.
    webhook_secret: {
        type: String,
        default: null
    },

    // Persisted device fingerprint [os, browser, version]. Pinned at first
    // pair and reused on every reconnect so WhatsApp's anti-replay defenses
    // see a stable client identity across server restarts.
    browser_profile: {
        type: [String],
        default: null
    },

    // Live connection state for status polling via GET /api/bots/:id.
    connection_state: {
        type: String,
        enum: ['idle', 'connecting', 'connected', 'disconnected', 'reconnecting', 'logged_out', 'failed'],
        default: 'idle',
        index: true
    },

    // Timestamp of last connection_state change.
    last_state_change_at: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
userWhatsappBotSchema.index({ isActive: 1, isSuspended: 1 });

module.exports = mongoose.model('UserWhatsappBot', userWhatsappBotSchema, 'user_whatsapp_bots');
