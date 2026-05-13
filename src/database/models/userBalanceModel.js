const mongoose = require('mongoose');
const { Schema } = mongoose;

const userBalanceSchema = new Schema({
    user_id: {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    balance: {
        type: Number,
        default: 0
    },
    total_topup: {
        type: Number,
        default: 0
    },
    total_spent: {
        type: Number,
        default: 0
    },
    total_withdrawn: {
        type: Number,
        default: 0
    },
    total_settlement_income: {
        type: Number,
        default: 0
    }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('UserBalance', userBalanceSchema, 'user_balances');
