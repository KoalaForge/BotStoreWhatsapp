const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Payment Method Model (Read-Only)
 * Managed by koalabotbe (Laravel) via shared MongoDB collection.
 * This project only READs from this collection.
 *
 * Collection: payment_methods
 * - payment_gateway_slug references payment_gateways.slug
 * - code becomes the payment_method_code in transactions (e.g., 'linkqu-qris')
 */
const paymentMethodSchema = new Schema({
    code: { type: String, index: true },
    name: String,
    method_type: { type: String, index: true },
    payment_gateway_slug: { type: String, index: true },
    is_active: Boolean,
    processing_fee: Number,
    processing_fee_type: String,
    user_processing_fee: Number,
    user_processing_fee_type: String,
    min_amount: Number,
    max_amount: Number,
    configuration: Schema.Types.Mixed,
}, { strict: false, timestamps: false });

paymentMethodSchema.index({ code: 1, is_active: 1 });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema, 'payment_methods');
