const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * User Payment Gateway Model (Read-Only from bot perspective)
 * Managed by koalabotbe (Laravel) via shared MongoDB collection.
 * This project READs from this collection to resolve per-owner gateway config.
 *
 * Collection: user_payment_gateways
 * - user_id maps to ownerId in the bot system
 * - gateway_type maps to payment_gateways.gateway_type (e.g., 'linkqu')
 */
const userPaymentGatewaySchema = new Schema({
    user_id: { type: String, index: true },
    gateway_type: String,
    use_own_credentials: Boolean,
    encrypted_credentials: String,
    is_active: Boolean,
    last_validated_at: Date,
}, { strict: false, timestamps: false });

userPaymentGatewaySchema.index({ user_id: 1, is_active: 1 });

module.exports = mongoose.model('UserPaymentGateway', userPaymentGatewaySchema, 'user_payment_gateways');
