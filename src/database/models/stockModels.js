const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockVariantsSchema = new Schema({
    codeVariant: {
        type: String,
        required: true
    },
    dataStock: {
        type: String,
        required: true
    },
    profit: {
        type: Number,
        required: true
    },
    unitCost: {
        type: Number,
        required: false,
        default: null
    },
    stockBatchId: {
        type: String,
        required: false,
        default: null,
        index: true
    },
    stockOriginId: {
        type: String,
        required: false,
        index: true
    },
    stockSchemaVersion: {
        type: Number,
        required: false,
        index: true
    },
    stockState: {
        type: String,
        enum: ['available', 'reserved', 'sold', 'removed', 'expired', 'quarantined'],
        required: false,
        index: true
    },
    stateRevision: {
        type: Number,
        required: false
    },
    reservationToken: {
        type: String,
        required: false,
        index: true
    },
    reservedTransactionId: {
        type: String,
        required: false
    },
    reservedOrderItemId: {
        type: String,
        required: false
    },
    reservedAt: {
        type: Date,
        required: false
    },
    reservationExpiresAt: {
        type: Date,
        required: false,
        index: true
    },
    soldTransactionId: {
        type: String,
        required: false,
        index: true
    },
    soldOrderItemId: {
        type: String,
        required: false
    },
    availableAt: {
        type: Date,
        required: false,
        index: true
    },
    cycleGeneration: {
        type: Number,
        required: false
    },
    lastCycledAt: {
        type: Date,
        required: false
    },
    removedAt: {
        type: Date,
        required: false
    },
    removedReason: {
        type: String,
        required: false
    },
    // Owner isolation for MULTI mode
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    expires_at: {
        type: Date,
        default: null
        // Kapan credentials ini tidak bisa digunakan lagi.
        // Wajib diisi jika variant is_cyclable = true.
        // Digunakan backend untuk chain-break check saat cycle.
    }
}, {
    timestamps: true
});

// Compound index for efficient queries in MULTI mode
stockVariantsSchema.index({ ownerId: 1, codeVariant: 1 });

module.exports = mongoose.model('Stock_Data_Variants', stockVariantsSchema, "stock_data_variants");
