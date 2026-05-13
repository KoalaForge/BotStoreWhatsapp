const mongoose = require('mongoose');
const { Schema } = mongoose;

const transactionSchema = new Schema({
    transactionId: {
        type: String,
        required: true,
    },
    user_id: {
        type: String,
        required: true,
    },
    transaction_type: {
        type: String,
        enum: ['product', 'topup'],
        default: 'product',
        required: true
    },
    payment_method_code: {
        type: String,
        default: 'qris',
        required: true
    },
    orderChannel: {
        type: String,
        enum: ['web', 'telegram', 'whatsapp'],
        default: 'telegram',
        required: true
    },
    productCode: {
        type: String,
        required: false,
    },
    formattedDate: {
        type: String,
        required: true
    },
    payment_fee: {
        type: Number,
        required: true
    },
    orderQuantity: {
        type: Number,
        required: false,
        min: 1,
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0,
    },
    profit: {
        type: Number,
        required: true
    },
    orderData: {
        type: String,
        required: false,
    },
    chatId: {
        type: String,
        required: true,
    },
    messageId: {
        type: String,
        required: true,
    },
    isCanceled: {
        type: Boolean,
        required: true,
        default: false,
    },
    isSuccess: {
        type: Boolean,
        required: true,
        default: false,
    },
    isDelivered: {
        type: Boolean,
        required: true,
        default: false,
    },
    isReminded: {
        type: Boolean,
        required: true,
        default: false,
    },
    paid_at: {
        type: Date,
        required: false,
        default: null,
        // Timestamp when payment succeeds - populated in MULTI mode only
        // Can be set by webhook or polling process
    },
    settle_expected_at: {
        type: Date,
        required: false,
        default: null,
        // Expected settlement date (paid_at + 1 day) - MULTI mode only
        // Auto-calculated when paid_at is first set
    },
    is_settled: {
        type: Boolean,
        required: false,
        default: false,
        // Settlement completion status - MULTI mode only
    },
    settled_at: {
        type: Date,
        required: false,
        default: null,
        // Actual settlement completion date - MULTI mode only
    },
    payment_status: {
        type: String,
        required: false,
        default: null,
        // Payment status: "paid", "pending", "failed", etc.
    },
    payment_id: {
        type: String,
        required: false,
        default: null,
        // Payment ID - timestamp when payment succeeded
    },
    voucherCode: {
        type: String,
        required: false,
        default: null,
    },
    voucherDiscount: {
        type: Number,
        required: false,
        default: 0,
        min: 0,
    },
    topupAmount: {
        type: Number,
        required: false,
        default: null,
        min: 0,
        // Nominal yang akan ditambahkan ke saldo user (untuk topup, tanpa gateway fee)
        // totalPrice = nominal yang dibayar user (termasuk gateway fee)
        // topupAmount = nominal yang ditambahkan ke saldo (tanpa gateway fee)
    },
    // Flag for reseller orders (platform stock, markup profit)
    is_reseller_order: {
        type: Boolean,
        default: false
    },
    // Idempotency flags for owner balance operations (reseller orders)
    balance_deducted: {
        type: Boolean,
        default: false
    },
    balance_refunded: {
        type: Boolean,
        default: false
    },
    // Buyer notes — optional message from buyer to seller before checkout
    buyer_notes: {
        type: String,
        required: false,
        default: null,
        maxlength: 300
    },
    // Dual isolation for MULTI mode (both bot and owner)
    botId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    // Gateway's own reference ID for the transaction
    // For Tripay: stores data.reference (T1234...) returned when creating payment
    // Used by polling to check payment status (Tripay uses their ref, not merchant_ref)
    gateway_reference: {
        type: String,
        required: false,
        default: null,
    },
    // Platform reference for bidirectional traceability
    // For owner transactions: contains platform transaction ID (using standard format)
    // For platform transactions: contains owner transaction ID
    // Platform transactions use generatePlatformTransactionId() with default settings
    platform_reference: {
        type: String,
        required: false,
        default: null,
        index: true
    }
}, {
    timestamps: true
});

// Add indexes for better query performance
// Compound index for global stats queries (with MULTI mode support)
transactionSchema.index({ botId: 1, ownerId: 1, isSuccess: 1, isCanceled: 1 });

// Compound index for user-specific queries (with MULTI mode support)
transactionSchema.index({ botId: 1, ownerId: 1, user_id: 1, isSuccess: 1, isCanceled: 1 });

// Index for transactionId lookups (with MULTI mode support)
transactionSchema.index({ botId: 1, ownerId: 1, transactionId: 1 });

// Index for settlement queries (MULTI mode)
transactionSchema.index({ botId: 1, ownerId: 1, is_settled: 1, settle_expected_at: 1 });

// Index for ProcessTransaction polling loop — covers isDelivered + orderChannel for $or filter
transactionSchema.index({ botId: 1, ownerId: 1, isSuccess: 1, isCanceled: 1, isDelivered: 1, orderChannel: 1 });

module.exports = mongoose.model('Transaction', transactionSchema, "order_transactions");
