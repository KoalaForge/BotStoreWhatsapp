const mongoose = require('mongoose');
const { Schema } = mongoose;

const appStateSchema = new Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    state_type: {
        type: String,
        required: true,
        enum: ['reseller_order', 'voucher'],
        index: true
    },
    user_id: {
        type: String,
        required: true,
        index: true
    },
    data: {
        type: Schema.Types.Mixed,
        required: true
    },
    expires_at: {
        type: Date,
        required: true,
        index: true
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// TTL index — MongoDB automatically deletes documents when expires_at passes
appStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AppState', appStateSchema, 'app_states');
