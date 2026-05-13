const BaseRepository = require('./BaseRepository');
const OrderTransactionItemModel = require('../database/models/orderTransactionItemsModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * OrderTransactionItem Repository
 * Handles transaction line items with dual isolation (bot + owner)
 *
 * Purpose:
 * - Manage itemized transaction data
 * - Support multi-variant orders
 * - Maintain isolation per bot and owner
 *
 * Isolation: DualScoped (both botId and ownerId required in MULTI mode)
 */
class OrderTransactionItemRepository extends BaseRepository {
    constructor() {
        super(OrderTransactionItemModel, IsolationStrategy.DualScoped);
    }

    /**
     * Find items by transaction ObjectId
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {ObjectId} transactionObjectId - Transaction _id (ObjectId, not string transactionId)
     * @returns {Promise<Array>} - Array of items
     */
    async findByTransactionObjectId(context, transactionObjectId) {
        return await this.find(context, {
            order_transaction_id: transactionObjectId
        });
    }

    /**
     * Find items by variant code
     * Useful for reporting and analytics (e.g., how many times a variant was sold)
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @param {Object} options - Query options (sort, limit, etc.)
     * @returns {Promise<Array>} - Array of items
     */
    async findByVariantCode(context, codeVariant, options = {}) {
        return await this.find(context, { codeVariant }, options);
    }

    /**
     * Get total quantity sold for a variant
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Total quantity sold
     */
    async getTotalQuantitySold(context, codeVariant) {
        const items = await this.findByVariantCode(context, codeVariant);
        return items.reduce((total, item) => total + (item.quantity || 0), 0);
    }

    /**
     * Get total profit for a variant
     * Sums up all profit from data array across all items for this variant
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Total profit from this variant
     */
    async getTotalProfitByVariant(context, codeVariant) {
        const items = await this.findByVariantCode(context, codeVariant);
        let totalProfit = 0;

        for (const item of items) {
            if (item.data && Array.isArray(item.data)) {
                for (const stockItem of item.data) {
                    totalProfit += stockItem.profit || 0;
                }
            }
        }

        return totalProfit;
    }

    /**
     * Delete all items for a transaction
     * Use with caution - typically only for cleanup/testing
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {ObjectId} transactionObjectId - Transaction _id
     * @returns {Promise<Object>} - Delete result
     */
    async deleteByTransactionObjectId(context, transactionObjectId) {
        return await this.deleteMany(context, {
            order_transaction_id: transactionObjectId
        });
    }

    /**
     * Find cyclable items by transaction ObjectId
     * @param {Object} context - Repository context
     * @param {import('mongoose').Types.ObjectId} transactionObjectId - Transaction _id (ObjectId)
     * @returns {Promise<Array>} - Array of items with cycle_eligible_at set
     */
    async findCyclableItemsByTransaction(context, transactionObjectId) {
        return await this.find(context, {
            order_transaction_id: transactionObjectId.toString(),
            cycle_eligible_at: { $ne: null }
        });
    }

    /**
     * Get cycle summary counts for admin dashboard
     * @param {Object} context - Repository context (from ctx)
     * @param {Object} [filter] - Optional filter (e.g. { codeVariant: 'net7d' })
     * @returns {Promise<Object>} - { completedToday, upcoming, overdue, failed, stuck }
     */
    async getCycleSummary(context, filter = {}) {
        const now = new Date();
        const moment = require('moment-timezone');
        const startOfDay = moment().tz('Asia/Jakarta').startOf('day').toDate();
        const endOfDay = moment().tz('Asia/Jakarta').endOf('day').toDate();
        const upcoming6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);
        const overdue2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        const [completedToday, scheduled, upcoming, overdue, failed, stuck] = await Promise.all([
            this.count(context, { ...filter, cycled_at: { $gte: startOfDay, $lte: endOfDay } }),
            this.count(context, { ...filter, cycle_eligible_at: { $gt: now }, cycled_at: null }),
            this.count(context, { ...filter, cycle_eligible_at: { $gt: now, $lte: upcoming6h }, cycled_at: null }),
            this.count(context, { ...filter, cycle_eligible_at: { $gt: overdue2h, $lte: now }, cycled_at: null, cycle_failed: { $ne: true } }),
            this.count(context, { ...filter, cycle_eligible_at: { $lte: now }, cycled_at: null, cycle_failed: true, cycle_retry_count: { $lt: 3 } }),
            this.count(context, { ...filter, cycle_eligible_at: { $lte: now }, cycled_at: null, cycle_failed: true, cycle_retry_count: { $gte: 3 } })
        ]);

        return { completedToday, scheduled, upcoming, overdue, failed, stuck };
    }

    /**
     * Get list of stuck items needing manual attention (failed >= 3 retries)
     * @param {Object} context - Repository context
     * @param {number} limit - Max results (default 10)
     * @returns {Promise<Array>} - Array of stuck items
     */
    async findStuckCycleItems(context, limit = 10) {
        return await this.find(context, {
            cycle_eligible_at: { $lte: new Date() },
            cycled_at: null,
            cycle_failed: true,
            cycle_retry_count: { $gte: 3 }
        }, { limit, sort: { cycle_eligible_at: 1 } });
    }

    /**
     * Find ALL eligible items for bulk cycle (past due, not yet cycled, not chain-broken)
     * @param {Object} context - Repository context
     * @returns {Promise<Array>} - Array of all eligible items
     */
    async findAllEligibleForBulkCycle(context) {
        return await this.find(context, {
            cycle_eligible_at: { $lte: new Date() },
            cycled_at: null
        });
    }

    /**
     * Find overdue cycle items with parent transaction info for admin dashboard
     * Uses aggregation to join with order_transactions collection
     * @param {Object} context - Repository context
     * @param {number} limit - Max results (default 10)
     * @returns {Promise<Array>} - Items enriched with transactionId and user_id
     */
    async findOverdueWithTransactionInfo(context, limit = 10, filter = {}) {
        const pipeline = [
            { $match: {
                ...filter,
                cycle_eligible_at: { $lte: new Date() },
                cycled_at: null
            }},
            { $sort: { cycle_eligible_at: 1 } },
            { $limit: limit },
            { $addFields: { _txOid: { $toObjectId: '$order_transaction_id' } } },
            { $lookup: {
                from: 'order_transactions',
                localField: '_txOid',
                foreignField: '_id',
                as: '_tx'
            }},
            { $unwind: { path: '$_tx', preserveNullAndEmptyArrays: true } },
            { $project: {
                codeVariant: 1,
                quantity: 1,
                cycle_eligible_at: 1,
                cycle_failed: 1,
                cycle_retry_count: 1,
                data: 1,
                transactionId: '$_tx.transactionId',
                user_id: '$_tx.user_id'
            }}
        ];
        return await this.aggregate(context, pipeline);
    }

    /**
     * Find upcoming cycle items with parent transaction info (not yet due, not yet cycled)
     * @param {Object} context - Repository context
     * @param {number} limit - Max results (default 10)
     * @returns {Promise<Array>} - Items enriched with transactionId and user_id
     */
    async findIncomingWithTransactionInfo(context, limit = 10, filter = {}) {
        const pipeline = [
            { $match: {
                ...filter,
                cycle_eligible_at: { $gt: new Date() },
                cycled_at: null
            }},
            { $sort: { cycle_eligible_at: 1 } },
            { $limit: limit },
            { $addFields: { _txOid: { $toObjectId: '$order_transaction_id' } } },
            { $lookup: {
                from: 'order_transactions',
                localField: '_txOid',
                foreignField: '_id',
                as: '_tx'
            }},
            { $unwind: { path: '$_tx', preserveNullAndEmptyArrays: true } },
            { $project: {
                codeVariant: 1,
                quantity: 1,
                cycle_eligible_at: 1,
                data: 1,
                transactionId: '$_tx.transactionId',
                user_id: '$_tx.user_id'
            }}
        ];
        return await this.aggregate(context, pipeline);
    }

    /**
     * Find recently cycled items with parent transaction info (newest first)
     * @param {Object} context - Repository context
     * @param {number} limit - Max results (default 10)
     * @returns {Promise<Array>} - Items enriched with transactionId and user_id
     */
    async findRecentlyCycledWithTransactionInfo(context, limit = 10, filter = {}) {
        const pipeline = [
            { $match: { ...filter, cycled_at: { $ne: null } } },
            { $sort: { cycled_at: -1 } },
            { $limit: limit },
            { $addFields: { _txOid: { $toObjectId: '$order_transaction_id' } } },
            { $lookup: {
                from: 'order_transactions',
                localField: '_txOid',
                foreignField: '_id',
                as: '_tx'
            }},
            { $unwind: { path: '$_tx', preserveNullAndEmptyArrays: true } },
            { $project: {
                codeVariant: 1,
                quantity: 1,
                cycled_at: 1,
                data: 1,
                transactionId: '$_tx.transactionId',
                user_id: '$_tx.user_id'
            }}
        ];
        return await this.aggregate(context, pipeline);
    }

    /**
     * Atomic mark as cycled using CAS pattern (cycled_at must be null)
     * Returns modifiedCount = 1 if successful, 0 if race condition (already cycled)
     * @param {string|Object} itemId - _id of the item
     * @returns {Promise<Object>} - updateResult
     */
    async markAsCycled(itemId) {
        return await this.model.updateOne(
            { _id: itemId, cycled_at: null },
            { $set: { cycled_at: new Date(), cycle_failed: false } }
        );
    }

    /**
     * Clear cycle_eligible_at (used when transaction is cancelled/stock restored)
     * Prevents backend from cycling items whose stock was already manually restored
     * @param {string|Object} itemId - _id of the item
     * @returns {Promise<Object>} - updateResult
     */
    async clearCycleEligibility(itemId) {
        return await this.model.updateOne(
            { _id: itemId },
            { $set: { cycle_eligible_at: null } }
        );
    }

    /**
     * Batch aggregate total sold quantity per variant code.
     * Returns Map<codeVariant, totalQuantity>.
     */
    async batchSoldCount(context) {
        const results = await this.aggregate(context, [
            { $group: { _id: '$codeVariant', total: { $sum: '$quantity' } } }
        ]);
        const map = new Map();
        for (const r of results) {
            if (r._id) map.set(r._id, r.total);
        }
        return map;
    }
}

module.exports = new OrderTransactionItemRepository();
