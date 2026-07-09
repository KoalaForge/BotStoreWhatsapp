const mongoose = require('mongoose');
const { Schema } = mongoose;

const productSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    code: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true,
        required: false,
    },
    // When true, buyers must be whitelist-approved before opening/buying any
    // variant of this product (per-target opt-in; default off).
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
    // Platform flag: marks platform products available for reselling
    is_resellable: {
        type: Boolean,
        default: false
    },
    // Links reseller product → platform product code
    // Set by koalabotbe when reseller adds a platform product
    reseller_source_code: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries in MULTI mode
productSchema.index({ ownerId: 1, code: 1 });
productSchema.index({ ownerId: 1, isActive: 1 });
productSchema.index({ ownerId: 1, reseller_source_code: 1 });

module.exports = mongoose.model('Product', productSchema, "products");