const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * OrderTransactionItem Schema
 * Stores individual line items within a transaction with detailed stock data
 *
 * Purpose:
 * - Align with web system's itemized transaction structure
 * - Support multi-variant orders (1 transaction → N items)
 * - Preserve individual stock data with profit tracking
 * - Snapshot product info at time of transaction
 *
 * Relationship: Many items belong to one Transaction
 */
const orderTransactionItemSchema = new Schema({
    // === RELATION ===
    order_transaction_id: {
        type: String,
        ref: 'Transaction',
        required: true,
        index: true
    },

    // === VARIANT INFO ===
    codeVariant: {
        type: String,
        required: true,
        index: true
    },

    // === QUANTITY & PRICING ===
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    unit_price: {
        type: Number,
        required: true,
        min: 0
    },
    cost_price: {
        type: Number,
        default: null
        // Reseller's buy price per unit (platform price before markup)
        // null for normal (non-reseller) orders
    },
    subtotal: {
        type: Number,
        required: true,
        min: 0
        // Should equal quantity × unit_price
    },

    // === STOCK DATA SNAPSHOTS ===
    // Array of complete stock records (NOT just credentials)
    // Each element is a full copy of a StockDataVariant record
    // This preserves individual profit and audit trail even after stock deletion
    data: [{
        _id: {
            type: Schema.Types.ObjectId,
            required: true
        },
        codeVariant: {
            type: String,
            required: true
        },
        dataStock: {
            type: String, // The actual credential/account data
            required: true
        },
        profit: {
            type: Number,
            required: true
        },
        ownerId: {
            type: String,
            default: null
            // Owner of this stock record — null for platform/reseller pool
        },
        expires_at: {
            type: Date,
            default: null
            // When this credential expires. Used for chain-break detection during cycle.
            // Copied from stock_data_variants.expires_at at time of order payment.
        },
        createdAt: {
            type: Date,
            required: true
        },
        updatedAt: {
            type: Date,
            required: true
        }
    }],

    // === PRODUCT SNAPSHOTS ===
    // Denormalized data for reporting and historical accuracy
    // Product info is frozen at time of transaction
    product_code: {
        type: String,
        required: true
    },
    product_name: {
        type: String,
        required: true
    },
    variant_name: {
        type: String,
        required: true
    },

    // === MULTI-TENANCY ===
    // Dual isolation for MULTI mode (both bot and owner)
    // Must match parent transaction's botId and ownerId
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

    // === STOCK CYCLE FIELDS ===
    // Set oleh bot saat order items dibuat (jika variant is_cyclable)
    // Backend scheduler membaca ini untuk eksekusi cycle otomatis
    cycle_eligible_at: {
        type: Date,
        default: null
        // null = tidak cyclable. Terisi = waktu kapan credentials boleh dikembalikan ke pool.
        // Dihitung: paid_at + duration_days hari
    },
    cycled_at: {
        type: Date,
        default: null
        // null = belum di-cycle. Terisi = cycle berhasil dieksekusi oleh backend/manual.
    },
    cycle_retry_count: {
        type: Number,
        default: 0
        // Berapa kali cycle gagal dan di-retry (oleh backend). Maks 3x.
    },
    cycle_failed: {
        type: Boolean,
        default: false
        // true = cycle terakhir gagal (exception/DB error). Akan di-retry oleh backend.
    },
    cycle_chain_broken: {
        type: Boolean,
        default: false
        // true = rantai siklus terputus permanen.
        // Semua credentials di data[] sudah kedaluwarsa (expires_at lampau).
        // Terminal — tidak di-retry, tidak ada stok dikembalikan ke pool.
        // cycled_at juga di-stamp saat ini terjadi.
    }
}, {
    timestamps: true
});

// === INDEXES ===
// Compound index for multi-tenancy + transaction lookup
orderTransactionItemSchema.index({ botId: 1, ownerId: 1, order_transaction_id: 1 });

// Compound index for multi-tenancy + variant queries (reporting)
orderTransactionItemSchema.index({ botId: 1, ownerId: 1, codeVariant: 1 });

// Direct transaction lookup (for getTransactionItems)
orderTransactionItemSchema.index({ order_transaction_id: 1 });

// Compound index untuk cycle scheduler query
orderTransactionItemSchema.index({
    cycle_eligible_at: 1,
    cycled_at: 1,
    cycle_failed: 1
});

// === VIRTUALS ===
// Calculate total profit from all stock items in this line item
orderTransactionItemSchema.virtual('totalProfit').get(function() {
    if (!this.data || this.data.length === 0) {
        return 0;
    }
    return this.data.reduce((sum, item) => sum + (item.profit || 0), 0);
});

// Ensure virtuals are included when converting to JSON
orderTransactionItemSchema.set('toJSON', { virtuals: true });
orderTransactionItemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('OrderTransactionItem', orderTransactionItemSchema, 'order_transaction_items');
