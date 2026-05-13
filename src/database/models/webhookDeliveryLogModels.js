const mongoose = require('mongoose');
const { Schema } = mongoose;

const webhookDeliveryLogSchema = new Schema({
    envelope_id: { type: String, required: true, index: true },
    bot_id: { type: String, required: true, index: true },
    event: { type: String, required: true, index: true },
    url: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
        type: String,
        enum: ['pending', 'delivered', 'failed'],
        default: 'pending',
        index: true
    },
    attempts: { type: Number, default: 0 },
    response_code: { type: Number, default: null },
    response_body: { type: String, default: null },
    last_attempt_at: { type: Date, default: null },
    // TTL: documents expire 7 days after creation
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }
}, { timestamps: { createdAt: false, updatedAt: true } });

webhookDeliveryLogSchema.index({ bot_id: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model(
    'WebhookDeliveryLog',
    webhookDeliveryLogSchema,
    'webhook_delivery_logs'
);
