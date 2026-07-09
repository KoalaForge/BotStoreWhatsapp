const mongoose = require('mongoose');
const { Schema } = mongoose;

const productVariantsSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    code: {
        type: String,
        required: true
    },
    codeVariant: {
        type: String,
        required: true
    },
    descriptionVariant: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    keteranganVariant: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true,
        required: false,
    },
    // When true, buyers must be whitelist-approved before opening/buying THIS
    // variant (per-target opt-in; default off).
    requiresWhitelist: {
        type: Boolean,
        default: false,
        required: false,
    },
    // Owner isolation for MULTI mode
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    // Role-based pricing configuration
    // Managed from Laravel admin, bot only reads
    // Example: { Explorer: { type: 'percentage', value: 0 }, Connector: { type: 'percentage', value: -15 }, Provider: { type: 'fixed', value: -5000 } }
    role_pricing: {
        type: Map,
        of: {
            type: { type: String, enum: ['fixed', 'percentage'] },
            value: { type: Number, default: 0 }
        },
        default: null
    },
    tier_pricing: {
        type: [{
            _id: false,
            min_qty: { type: Number, required: true },
            price:   { type: Number, required: true }
        }],
        default: []
    },
    is_cyclable: {
        type: Boolean,
        default: false,
        required: false
    },
    duration_days: {
        type: Number,
        default: null,
        required: false
        // Durasi produk dalam hari. Dipakai hitung cycle_eligible_at.
        // null = tidak cyclable. Bisa terisi meski is_cyclable=false (untuk info tampilan)
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries in MULTI mode
productVariantsSchema.index({ ownerId: 1, code: 1 });
productVariantsSchema.index({ ownerId: 1, codeVariant: 1 });
productVariantsSchema.index({ ownerId: 1, isActive: 1 });
productVariantsSchema.index({ ownerId: 1, is_cyclable: 1 });

module.exports = mongoose.model('Product_Variants', productVariantsSchema, "product_variants");