const mongoose = require('mongoose');
const { Schema } = mongoose;

const snkSchema = new Schema({
    codeVariant: {
        type: String,
        required: true
    },
    // At least one of these fields must have content (validated in service layer)
    termsAndConditions: {
        type: String,
        default: ''
    },
    warrantyTerms: {
        type: String,
        default: ''
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

// Compound index for efficient queries in MULTI mode
snkSchema.index({ ownerId: 1, codeVariant: 1 });

module.exports = mongoose.model('Product_Variant_Snk', snkSchema, "product_variant_snk");