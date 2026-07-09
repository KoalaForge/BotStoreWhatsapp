const mongoose = require('mongoose');
const { Schema } = mongoose;

// Per-buyer purchase ban, scoped either to a single variant (codeVariant) or an
// entire product (all its variants). Presence of a row means "banned" — unban
// deletes the row. Enforced whenever a matching row exists (no global flag).
const variantBanSchema = new Schema({
    idWhatsapp: {
        type: String,
        required: true
    },
    scope: {
        type: String,
        enum: ['variant', 'product'],
        required: true
    },
    // Set when scope === 'variant'. Stored lowercase (case-insensitive).
    codeVariant: {
        type: String,
        default: null
    },
    // Set when scope === 'product'.
    productCode: {
        type: String,
        default: null
    },
    name: {
        type: String,
        default: null
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

// One ban row per (owner, user, scope, target). null codeVariant/productCode is
// a distinct value, so variant and product bans never collide.
// Partial filter: this collection is shared with the Telegram bot (idTelegram
// rows); scope uniqueness to WhatsApp rows only so absent-idWhatsapp TG rows
// don't collide on this index.
variantBanSchema.index(
    { ownerId: 1, idWhatsapp: 1, scope: 1, codeVariant: 1, productCode: 1 },
    { unique: true, partialFilterExpression: { idWhatsapp: { $exists: true } } }
);
// Lookup indexes for the purchase guard
variantBanSchema.index({ ownerId: 1, idWhatsapp: 1, codeVariant: 1 });
variantBanSchema.index({ ownerId: 1, idWhatsapp: 1, productCode: 1 });

module.exports = mongoose.model('Variant_Bans', variantBanSchema, 'variant_bans');
