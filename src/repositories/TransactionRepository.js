const BaseRepository = require('./BaseRepository');
const TransactionModel = require('../database/models/transactionModels');
const IsolationStrategy = require('./IsolationStrategy');
const modeService = require('../services/modeService');

/**
 * Transaction Repository
 * Handles transactions with dual isolation (bot + owner)
 *
 * Isolation Strategy: IsolationStrategy.DualScoped
 * - Transactions are isolated per bot AND per owner
 * - Filter by both botId and ownerId in MULTI mode
 * - No filtering in SINGLE mode
 */
class TransactionRepository extends BaseRepository {
    constructor() {
        // Transactions are DualScoped
        super(TransactionModel, IsolationStrategy.DualScoped);
    }

    /**
     * Find transaction by ID
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object|null>} - Transaction document
     */
    async findByTransactionId(context, transactionId) {
        return await this.findOne(context, { transactionId });
    }

    /**
     * Find pending transactions (not canceled, not successful)
     * @param {Object} context - Repository context
     * @returns {Promise<Array>} - Array of pending transactions
     */
    async findPendingTransactions(context) {
        return await this.find(context, {
            isCanceled: false,
            isSuccess: false
        });
    }

    /**
     * Find pending or undelivered transactions
     * @param {Object} context - Repository context
     * @returns {Promise<Array>} - Array of transactions needing processing
     */
    async findTransactionsNeedingProcessing(context) {
        return await this.find(context, {
            $or: [
                { isSuccess: false, isCanceled: false },
                { isSuccess: true, isDelivered: false, isCanceled: false }
            ]
        });
    }

    /**
     * Find user's pending transaction
     * @param {Object} context - Repository context
     * @param {number} user_id - Telegram user ID
     * @param {string} transactionType - Optional: 'product' or 'topup'
     * @returns {Promise<Object|null>} - Pending transaction or null
     */
    async findUserPendingTransaction(context, user_id, transactionType = null) {
        const filter = {
            user_id,
            isSuccess: false,
            isCanceled: false
        };

        if (transactionType) {
            filter.transaction_type = transactionType;
        }

        return await this.findOne(context, filter);
    }

    /**
     * Find user's successful transactions
     * @param {Object} context - Repository context
     * @param {number} user_id - Telegram user ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of transactions
     */
    async findUserSuccessfulTransactions(context, user_id, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(
            context,
            {
                user_id,
                isSuccess: true,
                isCanceled: false
            },
            defaultOptions
        );
    }

    /**
     * Find user's transaction history
     * @param {Object} context - Repository context
     * @param {number} user_id - Telegram user ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of transactions
     */
    async findUserTransactionHistory(context, user_id, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(context, { user_id }, defaultOptions);
    }

    /**
     * Count successful transactions
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Count
     */
    async countSuccessfulTransactions(context) {
        return await this.count(context, {
            isSuccess: true,
            isCanceled: false
        });
    }

    /**
     * Count user's successful orders
     * @param {Object} context - Repository context
     * @param {number} user_id - Telegram user ID
     * @returns {Promise<number>} - Count
     */
    async countUserSuccessfulOrders(context, user_id) {
        return await this.count(context, {
            user_id,
            isSuccess: true,
            isCanceled: false
        });
    }

    /**
     * Sum total revenue (successful transactions)
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Total revenue
     */
    async sumSuccessfulRevenue(context) {
        const result = await this.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalPrice' }
                }
            }
        ]);

        return result.length > 0 ? result[0].total : 0;
    }

    /**
     * Sum total profit (successful transactions)
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Total profit
     */
    async sumSuccessfulProfit(context) {
        const result = await this.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$profit' }
                }
            }
        ]);

        return result.length > 0 ? result[0].total : 0;
    }

    /**
     * Sum user's total spending
     * @param {Object} context - Repository context
     * @param {number} user_id - Telegram user ID
     * @returns {Promise<number>} - Total spending
     */
    async sumUserTotalSpending(context, user_id) {
        const result = await this.aggregate(context, [
            {
                $match: {
                    user_id,
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalPrice' }
                }
            }
        ]);

        return result.length > 0 ? result[0].total : 0;
    }

    /**
     * Get top buyers
     * @param {Object} context - Repository context
     * @param {number} limit - Number of top buyers (default: 5)
     * @returns {Promise<Array>} - Array of top buyers
     */
    async getTopBuyers(context, limit = 5) {
        return await this.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: '$user_id',
                    totalSpent: { $sum: '$totalPrice' },
                    totalOrders: { $sum: 1 }
                }
            },
            { $sort: { totalSpent: -1 } },
            { $limit: limit }
        ]);
    }

    /**
     * Mark transaction as reminded
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} - Update result
     */
    async markAsReminded(context, transactionId) {
        return await this.updateOne(
            context,
            { transactionId },
            { $set: { isReminded: true } }
        );
    }

    /**
     * Mark transaction as successful
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @param {Date|string|null} paidAt - Payment date (optional, for settlement tracking in MULTI mode)
     * @returns {Promise<Object>} - Update result
     */
    async markAsSuccess(context, transactionId, paidAt = null, useOwnCredentials = false) {
        const updateFields = {
            isSuccess: true,
            isDelivered: true,
            payment_status: "paid",
            payment_id: Date.now().toString()
        };

        // Add settlement tracking fields (no nested if - early return when not applicable)
        const settlementFields = this._getSettlementFields(paidAt, useOwnCredentials);
        console.log('[markAsSuccess] transactionId:', transactionId, 'paidAt:', paidAt, 'useOwnCredentials:', useOwnCredentials, 'settlementFields:', settlementFields);
        Object.assign(updateFields, settlementFields);

        const result = await this.updateOne(
            context,
            { transactionId },
            { $set: updateFields }
        );

        // Update platform record using platform_reference with same settlement fields
        const platformUpdateFields = {
            isSuccess: true,
            isDelivered: true,
            payment_status: 'paid'
        };
        Object.assign(platformUpdateFields, settlementFields);

        console.log('[markAsSuccess] Updating platform record with platform_reference:', transactionId, 'fields:', platformUpdateFields);
        const platformResult = await TransactionModel.updateOne(
            {
                platform_reference: transactionId,
                botId: null,
                ownerId: null
            },
            { $set: platformUpdateFields }
        );
        console.log('[markAsSuccess] Platform update result:', platformResult);

        return result;
    }

    /**
     * Calculate settlement fields based on payment method
     * No nested if - returns empty object for SINGLE mode or when no paidAt
     *
     * @param {Date|string|null} paidAt - Payment date
     * @param {boolean} useOwnCredentials - Whether owner uses their own gateway
     * @returns {Object} - Settlement fields to add to update
     */
    _getSettlementFields(paidAt, useOwnCredentials) {
        // Early return: no settlement tracking needed
        if (!modeService.isMultiMode() || !paidAt) {
            console.log('[_getSettlementFields] Skipping - isMultiMode:', modeService.isMultiMode(), 'paidAt:', paidAt);
            return {};
        }

        const paidDate = paidAt instanceof Date ? paidAt : new Date(paidAt);
        const baseFields = { paid_at: paidDate };

        // Owner gateway: auto-settled
        if (useOwnCredentials) {
            return {
                ...baseFields,
                is_settled: true,
                settled_at: paidDate
            };
        }

        // Platform gateway: settlement expected in 1 day
        const settleExpected = new Date(paidDate);
        settleExpected.setDate(settleExpected.getDate() + 1);
        return {
            ...baseFields,
            settle_expected_at: settleExpected
        };
    }

    /**
     * Mark transaction as delivered
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} - Update result
     */
    async markAsDelivered(context, transactionId) {
        return await this.updateOne(
            context,
            { transactionId },
            { $set: { isDelivered: true } }
        );
    }

    /**
     * Cancel transaction
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} - Update result
     */
    async cancelTransaction(context, transactionId) {
        const result = await this.updateOne(
            context,
            { transactionId },
            { $set: { isCanceled: true, payment_status: 'cancelled' } }
        );

        // Also update platform record using platform_reference if exists
        await TransactionModel.updateOne(
            {
                platform_reference: transactionId,  // Find platform record that references this transaction
                botId: null,                         // Platform record identifier
                ownerId: null                        // Platform record identifier
            },
            { $set: { isCanceled: true, payment_status: 'cancelled' } }
        );

        return result;
    }

    /**
     * Expire transaction (timeout/expired payment)
     * @param {Object} context - Repository context
     * @param {string} transactionId - Transaction ID
     * @returns {Promise<Object>} - Update result
     */
    async expireTransaction(context, transactionId) {
        const result = await this.updateOne(
            context,
            { transactionId },
            { $set: { isCanceled: true, payment_status: 'expired' } }
        );

        // Also update platform record using platform_reference if exists
        await TransactionModel.updateOne(
            {
                platform_reference: transactionId,  // Find platform record that references this transaction
                botId: null,                         // Platform record identifier
                ownerId: null                        // Platform record identifier
            },
            { $set: { isCanceled: true, payment_status: 'expired' } }
        );

        return result;
    }

    /**
     * Get transaction statistics for a date range
     * @param {Object} context - Repository context
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Object>} - Transaction statistics
     */
    async getTransactionStats(context, startDate, endDate) {
        const result = await this.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false,
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$totalPrice' },
                    totalProfit: { $sum: '$profit' },
                    totalOrders: { $sum: 1 },
                    totalQuantity: { $sum: '$orderQuantity' }
                }
            }
        ]);

        if (result.length > 0) {
            return result[0];
        }

        return {
            totalRevenue: 0,
            totalProfit: 0,
            totalOrders: 0,
            totalQuantity: 0
        };
    }

    /**
     * Find transactions by date range
     * @param {Object} context - Repository context
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of transactions
     */
    async findByDateRange(context, startDate, endDate, options = {}) {
        const defaultOptions = { sort: { createdAt: -1 }, ...options };
        return await this.find(
            context,
            {
                createdAt: { $gte: startDate, $lte: endDate }
            },
            defaultOptions
        );
    }
}

module.exports = new TransactionRepository();
