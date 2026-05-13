const mongoose = require('mongoose');
const { Schema } = mongoose;

const voucherSchema = new Schema({
    code: {
        type: String,
        required: true,
        // Note: unique removed - will use compound index with botId instead
        uppercase: true,
        trim: true,
    },
    discount_type: {
        type: String,
        enum: ['fixed', 'percentage'],
        required: true,
    },
    discount_value: {
        type: Number,
        required: true,
        min: 0,
    },
    max_uses: {
        type: Number,
        required: false,
        default: null,
        min: 0,
    },
    used_count: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    min_order_amount: {
        type: Number,
        required: false,
        default: 0,
        min: 0,
    },
    max_discount_amount: {
        type: Number,
        required: false,
        default: 0,
        min: 0,
    },
    description: {
        type: String,
        required: false,
        default: '',
    },
    start_date: {
        type: Date,
        required: false,
        default: null,
    },
    end_date: {
        type: Date,
        required: false,
        default: null,
    },
    is_active: {
        type: Boolean,
        required: true,
        default: true,
    },
    // Owner isolation for MULTI mode
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    }
}, {
    timestamps: true,
    collection: 'vouchers' // Same collection as web backend
});

// Compound unique index for MULTI mode (voucher code unique per owner)
voucherSchema.index({ ownerId: 1, code: 1 }, { unique: true });

// Additional compound indexes for efficient queries
voucherSchema.index({ ownerId: 1, is_active: 1 });

/**
 * Check if voucher is currently valid
 * @returns {boolean}
 */
voucherSchema.methods.isValid = function() {
    const now = new Date();

    // Check if active
    if (!this.is_active) {
        return false;
    }

    // Check if started
    if (this.start_date && this.start_date > now) {
        return false;
    }

    // Check if expired
    if (this.end_date && this.end_date < now) {
        return false;
    }

    // Check usage limit
    if (this.max_uses && this.used_count >= this.max_uses) {
        return false;
    }

    return true;
};

/**
 * Get remaining uses for this voucher
 * @returns {number|null} - Remaining uses or null if unlimited
 */
voucherSchema.methods.getRemainingUses = function() {
    if (!this.max_uses) {
        return null; // Unlimited
    }

    return Math.max(0, this.max_uses - this.used_count);
};

/**
 * Calculate discount amount based on order amount
 * @param {number} orderAmount - Total order amount
 * @returns {number} - Discount amount in IDR
 */
voucherSchema.methods.calculateDiscount = function(orderAmount) {
    let discount = 0;

    if (this.discount_type === 'percentage') {
        discount = Math.floor((orderAmount * this.discount_value) / 100);
    } else {
        discount = this.discount_value;
    }

    // Apply max discount cap if set
    if (this.max_discount_amount > 0) {
        discount = Math.min(discount, this.max_discount_amount);
    }

    return discount;
};

/**
 * Increment usage counter
 * @returns {Promise<void>}
 */
voucherSchema.methods.incrementUsage = async function() {
    this.used_count += 1;
    await this.save();
};

/**
 * Get human-readable reason why voucher is invalid
 * @returns {string}
 */
voucherSchema.methods.getInvalidReason = function() {
    const now = new Date();

    if (!this.is_active) {
        return 'Voucher sudah tidak aktif';
    }

    if (this.start_date && this.start_date > now) {
        const startDate = this.start_date.toLocaleDateString('id-ID');
        return `Voucher belum dapat digunakan (mulai ${startDate})`;
    }

    if (this.end_date && this.end_date < now) {
        const endDate = this.end_date.toLocaleDateString('id-ID');
        return `Voucher sudah kadaluarsa (berakhir ${endDate})`;
    }

    if (this.max_uses && this.used_count >= this.max_uses) {
        return 'Voucher sudah habis terpakai';
    }

    return 'Voucher tidak valid';
};

module.exports = mongoose.model('Voucher', voucherSchema, 'vouchers');
