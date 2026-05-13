const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Payment Gateway Model (Read-Only)
 * Managed by koalabotbe (Laravel) via shared MongoDB collection.
 * This project only READs from this collection.
 *
 * Collection: payment_gateways
 */
const paymentGatewaySchema = new Schema({
    slug: { type: String, index: true },
    name: String,
    gateway_type: { type: String, index: true },
    is_active: Boolean,
    is_sandbox: Boolean,
    is_available_for_user: Boolean,
    credentials: Schema.Types.Mixed,
}, { strict: false, timestamps: false });

module.exports = mongoose.model('PaymentGateway', paymentGatewaySchema, 'payment_gateways');
