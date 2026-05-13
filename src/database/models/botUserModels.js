const mongoose = require('mongoose');
const { Schema } = mongoose;

const BotUserSchema = new Schema({
    usernameTelegram: {
        type: String,
    },
    idTelegram: {
        type: String
    },
    idWhatsapp: {
        type: String,
        default: null
    },
    is_banned: {
        type: Boolean,
        default: false
    },
    ban_reason: {
        type: String,
        default: null
    },
    banned_at: {
        type: Date,
        default: null
    },
    banned_by: {
        type: String,
        default: null
    },
    // Bot isolation for MULTI mode
    botId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    // Whitelist mode (admin-gated access, default-off feature). All fields optional;
    // legacy users without these fields default to 'none' status when read.
    whitelist_status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none',
        index: true
    },
    whitelist_requested_at: {
        type: Date,
        default: null
    },
    whitelist_actioned_at: {
        type: Date,
        default: null
    },
    // Polymorphic: String (phone/JID for bot-side action) or Mongo _id of web admin (dashboard-side action).
    whitelist_actioned_by: {
        type: Schema.Types.Mixed,
        default: null
    },
    whitelist_request_count: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for efficient queries in MULTI mode
BotUserSchema.index({ botId: 1, idTelegram: 1 });
BotUserSchema.index({ botId: 1, is_banned: 1 });

// WhatsApp indexes
BotUserSchema.index({ idWhatsapp: 1 }, { sparse: true });
BotUserSchema.index({ botId: 1, idWhatsapp: 1 }, { sparse: true });
BotUserSchema.index({ botId: 1, whitelist_status: 1 });

module.exports = mongoose.model('BotUser', BotUserSchema, "bot_users");
