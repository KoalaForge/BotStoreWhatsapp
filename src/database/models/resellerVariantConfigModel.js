const mongoose = require('mongoose');
const { Schema } = mongoose;

const resellerVariantConfigSchema = new Schema({
    product_code: {
        type: String,
        required: true
    },
    platform_variant_code: {
        type: String,
        required: true
    },
    custom_name: {
        type: String,
        default: null
    },
    markup_type: {
        type: String,
        enum: ['fixed', 'percentage'],
        required: true
    },
    markup_value: {
        type: Number,
        required: true,
        default: 0
    },
    tier_overrides: { type: Schema.Types.Mixed, default: {} },
    is_active: {
        type: Boolean,
        default: true
    },
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    }
}, {
    // Use snake_case timestamps to match koalabotbe (Laravel) convention
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    collection: 'reseller_variant_configs'
});

// Compound indexes for efficient queries
resellerVariantConfigSchema.index({ ownerId: 1, product_code: 1 });
resellerVariantConfigSchema.index({ ownerId: 1, platform_variant_code: 1 });

module.exports = mongoose.model('ResellerVariantConfig', resellerVariantConfigSchema, 'reseller_variant_configs');
