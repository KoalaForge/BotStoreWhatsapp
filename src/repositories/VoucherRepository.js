const BaseRepository = require('./BaseRepository');
const VoucherModel = require('../database/models/voucherModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Voucher Repository
 * Handles voucher CRUD with bot-level isolation
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - Vouchers are specific to each bot
 * - Filter by botId in MULTI mode
 * - No filtering in SINGLE mode
 */
class VoucherRepository extends BaseRepository {
    constructor() {
        super(VoucherModel, IsolationStrategy.OwnerScoped);
    }

    /**
     * Override findOne to disable lean — returns full Mongoose documents
     * so that schema instance methods (isValid, calculateDiscount, etc.) are available
     */
    async findOne(ctxOrContext, filter = {}, options = {}) {
        return await super.findOne(ctxOrContext, filter, { ...options, lean: false });
    }

    /**
     * Override find to disable lean — returns full Mongoose documents
     * so that schema instance methods (isValid, calculateDiscount, etc.) are available
     */
    async find(ctxOrContext, filter = {}, options = {}) {
        return await super.find(ctxOrContext, filter, { ...options, lean: false });
    }

    /**
     * Find voucher by code
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code (case-insensitive)
     * @returns {Promise<Object|null>} - Voucher document
     */
    async findByCode(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.findOne(context, { code: upperCode });
    }

    /**
     * Find all active vouchers
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of active vouchers
     */
    async findActiveVouchers(context, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(context, { is_active: true }, defaultOptions);
    }

    /**
     * Find all vouchers
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of vouchers
     */
    async findAllVouchers(context, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(context, {}, defaultOptions);
    }

    /**
     * Create voucher
     * @param {Object} context - Repository context
     * @param {Object} voucherData - Voucher data
     * @returns {Promise<Object>} - Created voucher document
     */
    async createVoucher(context, voucherData) {
        // Ensure code is uppercase
        const data = {
            ...voucherData,
            code: voucherData.code.toUpperCase().trim()
        };

        return await this.create(context, data);
    }

    /**
     * Update voucher
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @param {Object} updates - Update data
     * @returns {Promise<Object>} - Update result
     */
    async updateVoucher(context, code, updates) {
        const upperCode = code.toUpperCase().trim();
        return await this.updateOne(context, { code: upperCode }, { $set: updates });
    }

    /**
     * Delete voucher
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteVoucher(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.deleteOne(context, { code: upperCode });
    }

    /**
     * Activate voucher
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @returns {Promise<Object>} - Update result
     */
    async activateVoucher(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.updateOne(context, { code: upperCode }, { $set: { is_active: true } });
    }

    /**
     * Deactivate voucher
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @returns {Promise<Object>} - Update result
     */
    async deactivateVoucher(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.updateOne(context, { code: upperCode }, { $set: { is_active: false } });
    }

    /**
     * Increment voucher usage count
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @returns {Promise<Object>} - Update result
     */
    async incrementUsage(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.updateOne(context, { code: upperCode }, { $inc: { used_count: 1 } });
    }

    /**
     * Check if voucher code exists
     * @param {Object} context - Repository context
     * @param {string} code - Voucher code
     * @returns {Promise<boolean>} - True if exists
     */
    async existsByCode(context, code) {
        const upperCode = code.toUpperCase().trim();
        return await this.exists(context, { code: upperCode });
    }

    /**
     * Find valid vouchers (active, within date range, not fully used)
     * @param {Object} context - Repository context
     * @returns {Promise<Array>} - Array of valid vouchers
     */
    async findValidVouchers(context) {
        const now = new Date();

        return await this.find(context, {
            is_active: true,
            $or: [
                { start_date: null },
                { start_date: { $lte: now } }
            ],
            $or: [
                { end_date: null },
                { end_date: { $gte: now } }
            ]
        });
    }

    /**
     * Find expired vouchers
     * @param {Object} context - Repository context
     * @returns {Promise<Array>} - Array of expired vouchers
     */
    async findExpiredVouchers(context) {
        const now = new Date();

        return await this.find(context, {
            end_date: { $lt: now }
        });
    }

    /**
     * Find vouchers by discount type
     * @param {Object} context - Repository context
     * @param {string} discountType - 'fixed' or 'percentage'
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of vouchers
     */
    async findByDiscountType(context, discountType, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(context, { discount_type: discountType }, defaultOptions);
    }

    /**
     * Count total vouchers
     * @param {Object} context - Repository context
     * @param {boolean} activeOnly - Count only active vouchers
     * @returns {Promise<number>} - Voucher count
     */
    async countVouchers(context, activeOnly = false) {
        const filter = activeOnly ? { is_active: true } : {};
        return await this.count(context, filter);
    }

    /**
     * Get voucher usage statistics
     * @param {Object} context - Repository context
     * @returns {Promise<Object>} - Usage statistics
     */
    async getUsageStats(context) {
        const result = await this.aggregate(context, [
            {
                $group: {
                    _id: null,
                    totalVouchers: { $sum: 1 },
                    totalUsed: { $sum: '$used_count' },
                    activeVouchers: {
                        $sum: { $cond: ['$is_active', 1, 0] }
                    }
                }
            }
        ]);

        if (result.length > 0) {
            return result[0];
        }

        return {
            totalVouchers: 0,
            totalUsed: 0,
            activeVouchers: 0
        };
    }

    /**
     * Find vouchers with usage near limit
     * @param {Object} context - Repository context
     * @param {number} threshold - Percentage threshold (e.g., 80 for 80%)
     * @returns {Promise<Array>} - Array of vouchers near limit
     */
    async findVouchersNearLimit(context, threshold = 80) {
        const vouchers = await this.find(context, {
            max_uses: { $ne: null, $gt: 0 }
        });

        return vouchers.filter(voucher => {
            const usagePercent = (voucher.used_count / voucher.max_uses) * 100;
            return usagePercent >= threshold;
        });
    }
}

module.exports = new VoucherRepository();
