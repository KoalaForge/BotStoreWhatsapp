const userBalanceModel = require('../database/models/userBalanceModel');
const balanceTransactionModel = require('../database/models/balanceTransactionModel');
const modeService = require('./modeService');

/**
 * Owner Balance Service
 * Central service for owner (reseller) balance operations.
 * All methods guard with modeService.isSingleMode() → early return (no-op).
 * Uses atomic $inc with $gte guard for all mutations.
 */
class OwnerBalanceService {
    /**
     * Get available balance for an owner
     * @param {string} ownerId - Owner's user_id (MongoDB ObjectId string)
     * @returns {Promise<number>} - Available balance (0 if not found or SINGLE mode)
     */
    async getAvailableBalance(ownerId) {
        if (modeService.isSingleMode()) return 0;
        if (!ownerId) return 0;

        const record = await userBalanceModel.findOne({ user_id: ownerId });
        return record?.balance || 0;
    }

    /**
     * Check if owner has sufficient balance
     * @param {string} ownerId - Owner's user_id
     * @param {number} requiredAmount - Amount needed
     * @returns {Promise<boolean>}
     */
    async hasSufficientBalance(ownerId, requiredAmount) {
        if (modeService.isSingleMode()) return true;
        if (!ownerId) return true;
        if (requiredAmount <= 0) return true;

        const balance = await this.getAvailableBalance(ownerId);
        return balance >= requiredAmount;
    }

    /**
     * Validate reseller balance before order.
     * Single-call method for all balance pre-checks.
     * @param {string} ownerId - Owner's user_id
     * @param {Object} params
     * @param {boolean} params.isResellerOrder - Whether this is a reseller order
     * @param {number} params.costPerUnit - Cost price per unit (effectivePrice - markup)
     * @param {number} params.quantity - Order quantity
     * @returns {Promise<{ok: boolean, message?: string}>}
     */
    async validateResellerBalance(ownerId, { isResellerOrder, costPerUnit, quantity }) {
        if (!isResellerOrder) return { ok: true };
        if (modeService.isSingleMode()) return { ok: true };

        const totalCost = costPerUnit * quantity;
        if (totalCost <= 0) return { ok: true };

        const sufficient = await this.hasSufficientBalance(ownerId, totalCost);
        if (sufficient) return { ok: true };

        return {
            ok: false,
            message: 'Mohon maaf, produk ini sedang tidak tersedia saat ini. Silakan coba beberapa saat lagi atau hubungi admin toko.'
        };
    }

    /**
     * Atomic deduct balance for purchase.
     * Uses $inc with $gte guard to prevent negative balance.
     * Creates balance_transaction record for audit trail.
     *
     * @param {string} ownerId - Owner's user_id
     * @param {number} amount - Amount to deduct (positive number)
     * @param {Object} options
     * @param {string} options.transactionId - Reference transaction ID
     * @param {string} options.description - Human-readable description
     * @returns {Promise<{success: boolean, newBalance: number}>}
     * @throws {Error} If balance insufficient or SINGLE mode
     */
    async deductForPurchase(ownerId, amount, { transactionId, description }) {
        if (modeService.isSingleMode()) return { success: true, newBalance: 0 };
        if (!ownerId || amount <= 0) return { success: true, newBalance: 0 };

        // Ensure record exists
        await this._getOrCreateBalance(ownerId);

        // Capture balance_before
        const before = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceBefore = before?.balance || 0;

        // Atomic deduct with $gte guard
        const result = await userBalanceModel.updateOne(
            { user_id: ownerId, balance: { $gte: amount } },
            {
                $inc: {
                    balance: -amount,
                    total_spent: amount
                }
            }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Saldo platform tidak cukup untuk memproses pesanan reseller');
        }

        // Read back new balance
        const after = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceAfter = after?.balance || 0;

        // Create audit trail
        await balanceTransactionModel.create({
            user_balance_id: before?._id?.toString() || null,
            user_id: ownerId,
            type: 'purchase',
            amount: -amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: transactionId,
            reference_type: 'Pembelian',
            description: description,
            created_by: 'system'
        });

        return { success: true, newBalance: balanceAfter };
    }

    /**
     * Atomic credit balance for top-up.
     * @param {string} ownerId - Owner's user_id
     * @param {number} amount - Amount to credit (positive number)
     * @param {Object} options
     * @param {string} options.transactionId - Reference transaction ID
     * @param {string} options.description - Human-readable description
     * @returns {Promise<{success: boolean, newBalance: number}>}
     */
    async creditTopUp(ownerId, amount, { transactionId, description }) {
        if (modeService.isSingleMode()) return { success: true, newBalance: 0 };
        if (!ownerId || amount <= 0) return { success: true, newBalance: 0 };

        // Ensure record exists
        await this._getOrCreateBalance(ownerId);

        // Capture balance_before
        const before = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceBefore = before?.balance || 0;

        // Atomic credit
        await userBalanceModel.updateOne(
            { user_id: ownerId },
            {
                $inc: {
                    balance: amount,
                    total_topup: amount
                }
            }
        );

        // Read back new balance
        const after = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceAfter = after?.balance || 0;

        // Create audit trail
        await balanceTransactionModel.create({
            user_balance_id: before?._id?.toString() || null,
            user_id: ownerId,
            type: 'topup',
            amount: amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: transactionId,
            reference_type: 'Topup',
            description: description,
            created_by: 'system'
        });

        return { success: true, newBalance: balanceAfter };
    }

    /**
     * Atomic refund balance for cancelled order.
     * Idempotent: caller must check balance_refunded flag before calling.
     *
     * @param {string} ownerId - Owner's user_id
     * @param {number} amount - Amount to refund (positive number)
     * @param {Object} options
     * @param {string} options.transactionId - Reference transaction ID
     * @param {string} options.description - Human-readable description
     * @returns {Promise<{success: boolean, newBalance: number}>}
     */
    async refundForCancelledOrder(ownerId, amount, { transactionId, description }) {
        if (modeService.isSingleMode()) return { success: true, newBalance: 0 };
        if (!ownerId || amount <= 0) return { success: true, newBalance: 0 };

        // Ensure record exists
        await this._getOrCreateBalance(ownerId);

        // Capture balance_before
        const before = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceBefore = before?.balance || 0;

        // Atomic credit (refund)
        await userBalanceModel.updateOne(
            { user_id: ownerId },
            {
                $inc: {
                    balance: amount,
                    total_spent: -amount
                }
            }
        );

        // Read back new balance
        const after = await userBalanceModel.findOne({ user_id: ownerId });
        const balanceAfter = after?.balance || 0;

        // Create audit trail
        await balanceTransactionModel.create({
            user_balance_id: before?._id?.toString() || null,
            user_id: ownerId,
            type: 'refund',
            amount: amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: transactionId,
            reference_type: 'Pembelian',
            description: description,
            created_by: 'system'
        });

        return { success: true, newBalance: balanceAfter };
    }

    /**
     * Get recent balance transaction history
     * @param {string} ownerId - Owner's user_id
     * @param {number} limit - Max number of records
     * @returns {Promise<Array>}
     */
    async getRecentHistory(ownerId, limit = 5) {
        if (modeService.isSingleMode()) return [];
        if (!ownerId) return [];

        return await balanceTransactionModel
            .find({ user_id: ownerId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    /**
     * Get balance summary (balance + totals)
     * @param {string} ownerId - Owner's user_id
     * @returns {Promise<Object>} - { balance, total_topup, total_spent, total_withdrawn }
     */
    async getBalanceSummary(ownerId) {
        if (modeService.isSingleMode()) return { balance: 0, total_topup: 0, total_spent: 0, total_withdrawn: 0 };
        if (!ownerId) return { balance: 0, total_topup: 0, total_spent: 0, total_withdrawn: 0 };

        const record = await userBalanceModel.findOne({ user_id: ownerId }).lean();
        if (!record) return { balance: 0, total_topup: 0, total_spent: 0, total_withdrawn: 0 };

        return {
            balance: record.balance || 0,
            total_topup: record.total_topup || 0,
            total_spent: record.total_spent || 0,
            total_withdrawn: record.total_withdrawn || 0
        };
    }

    /**
     * Get or create user_balance record
     * @param {string} ownerId - Owner's user_id
     * @returns {Promise<Object>} - user_balance document
     * @private
     */
    async _getOrCreateBalance(ownerId) {
        let record = await userBalanceModel.findOne({ user_id: ownerId });
        if (record) return record;

        // Create new record (upsert to handle race conditions)
        await userBalanceModel.updateOne(
            { user_id: ownerId },
            {
                $setOnInsert: {
                    user_id: ownerId,
                    balance: 0,
                    total_topup: 0,
                    total_spent: 0,
                    total_withdrawn: 0,
                    total_settlement_income: 0
                }
            },
            { upsert: true }
        );

        return await userBalanceModel.findOne({ user_id: ownerId });
    }
}

module.exports = new OwnerBalanceService();
