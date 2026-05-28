const mongoose = require('mongoose');
const { Schema } = mongoose;

const settingSchema = new Schema({
    botId: {
        type: String,
        required: false,
        index: true  // For efficient queries in multi-mode
    },
    qrisTemplate: {
        type: String,
        required: false
    },
    qrisDotColor: {
        type: String,
        required: false
    },
    qrisSize: {
        type: Number,
        required: false
    },
    qrisX: {
        type: Number,
        required: false
    },
    qrisY: {
        type: Number,
        required: false
    },
    qrisBorderRadius: {
        type: Number,
        required: false
    },
    imageIntro: {
        type: String,
        required: false
    },
    companyName: {
        type: String,
        required: false
    },
    telegramIds: {
        type: String,
        required: false
    },
    sendNotification: {
        type: Boolean,
        required: false
    },
    productsPerPage: {
        type: Number,
        required: false,
        default: 10
    },
    productTransactionPrefix: {
        type: String,
        required: false,
        default: 'INV'
    },
    topupTransactionPrefix: {
        type: String,
        required: false,
        default: 'TOPUP'
    },
    feePaidBy: {
        type: String,
        enum: ['customer', 'merchant'],
        required: false,
        default: 'customer' // Default: customer pays the fee (backward compatible)
    },
    csLinks: {
        type: [mongoose.Schema.Types.Mixed],
        required: false,
        default: []
    },
    saldoEnabled: {
        type: Boolean,
        required: false,
        default: true
    },
    chatEnabled: {
        type: Boolean,
        required: false,
        default: true
    },
    welcomeEnabled: {
        type: Boolean,
        required: false,
        default: true
    },
    whitelistEnabled: {
        type: Boolean,
        required: false,
        default: false
    },
    qrisTemplateEnabled: {
        type: Boolean,
        required: false
    },
    showLastRestockEnabled: {
        type: Boolean,
        required: false,
        default: false
    },
}, {
    timestamps: true
});

module.exports = mongoose.model('Settings', settingSchema, "settings");