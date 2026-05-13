const mongoose = require('mongoose');
const { Schema } = mongoose;

const balanceTransactionSchema = new Schema({
    user_balance_id: {
        type: String,
        required: false
    },
    user_id: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        enum: ['topup', 'purchase', 'refund', 'withdrawal', 'admin_adjustment', 'settlement_income', 'settlement_fee']
    },
    amount: {
        type: Number,
        required: true
        // Signed: positive for credit, negative for debit
    },
    balance_before: {
        type: Number,
        required: true
    },
    balance_after: {
        type: Number,
        required: true
    },
    reference_id: {
        type: String,
        default: null
    },
    reference_type: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: null
    },
    created_by: {
        type: String,
        default: null
    }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound index for user history queries
balanceTransactionSchema.index({ user_id: 1, createdAt: -1 });

// Sparse index for reference lookups (e.g., find by transactionId)
balanceTransactionSchema.index({ reference_id: 1 }, { sparse: true });

module.exports = mongoose.model('BalanceTransaction', balanceTransactionSchema, 'balance_transactions');
