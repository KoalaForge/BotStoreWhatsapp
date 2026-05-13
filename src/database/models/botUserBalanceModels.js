const mongoose = require('mongoose');
const { Schema } = mongoose;

const BotUserBalanceSchema = new Schema({
    userId: {
        type: String,
        required: true,
    },
    balance: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    totalTopUp: {
        type: Number,
        required: true,
        default: 0,
    },
    totalSpent: {
        type: Number,
        required: true,
        default: 0,
    },
    // Bot isolation for MULTI mode
    botId: {
        type: String,
        required: false,
        index: true,
        default: null
    }
}, {
    timestamps: true
});

// Partial unique index for MULTI mode
// Only enforces uniqueness when botId is a string (new MULTI mode data)
// Allows old SINGLE mode data with null botId to coexist
BotUserBalanceSchema.index(
    { botId: 1, userId: 1 },
    {
        unique: true,
        partialFilterExpression: { botId: { $type: "string" } }
    }
);

module.exports = mongoose.model('BotUserBalance', BotUserBalanceSchema, "bot_user_balances");
