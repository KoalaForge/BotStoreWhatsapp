const mongoose = require('mongoose');
const { Schema } = mongoose;

// Per-(buyer, target) whitelist with admin approval. Scoped either to a single
// variant (codeVariant) or a whole product (productCode) — a buyer may open a
// variant if approved at variant scope OR at its product scope. The auto-request
// created when a gated variant is tapped follows the flagged scope. Gating is
// per product/variant via products/variants requiresWhitelist (no global flag).
const variantWhitelistSchema = new Schema({
    idWhatsapp: {
        type: String,
        required: true
    },
    scope: {
        type: String,
        enum: ['variant', 'product'],
        required: true
    },
    // Set when scope === 'variant' (lowercase).
    codeVariant: {
        type: String,
        default: null
    },
    // Set when scope === 'product' (lowercase).
    productCode: {
        type: String,
        default: null
    },
    name: {
        type: String,
        default: null
    },
    whitelist_status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    whitelist_requested_at: {
        type: Date,
        default: null
    },
    whitelist_actioned_at: {
        type: Date,
        default: null
    },
    // Polymorphic: String (phone for bot-side action) or Mongo _id of web admin.
    whitelist_actioned_by: {
        type: Schema.Types.Mixed,
        default: null
    },
    whitelist_request_count: {
        type: Number,
        default: 0
    },
    // Owner isolation for MULTI mode
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    }
}, {
    timestamps: true
});

// One row per (owner, user, scope, target).
// Partial filter: shared collection with the Telegram bot (idTelegram rows);
// scope uniqueness to WhatsApp rows only so absent-idWhatsapp TG rows don't
// collide on this index.
variantWhitelistSchema.index(
    { ownerId: 1, idWhatsapp: 1, scope: 1, codeVariant: 1, productCode: 1 },
    { unique: true, partialFilterExpression: { idWhatsapp: { $exists: true } } }
);
variantWhitelistSchema.index({ ownerId: 1, scope: 1, codeVariant: 1, whitelist_status: 1 });
variantWhitelistSchema.index({ ownerId: 1, scope: 1, productCode: 1, whitelist_status: 1 });

module.exports = mongoose.model('Variant_Whitelist', variantWhitelistSchema, 'variant_whitelist');
