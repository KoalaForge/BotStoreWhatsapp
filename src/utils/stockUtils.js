const TransactionModel = require('../database/models/transactionModels');

/**
 * Calculate total stock sold (quantity sum) for a product variant.
 *
 * Owner-scoped only (bypasses TransactionRepository's DualScoped strategy).
 * Sold count is a business-owner metric — same owner running multiple channels
 * (e.g. WhatsApp + Telegram bot) sees aggregated total across all channels.
 *
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {string} code - Product variant code
 * @returns {Promise<number>} - Total quantity sold
 */
const getStockTerjual = async (context, code) => {
    const match = {
        productCode: code,
        isSuccess: true,
        isCanceled: false,
        $or: [
            { transaction_type: 'product' },
            { transaction_type: { $exists: false } }
        ]
    };
    const ownerId = context?.ownerId ?? null;
    if (ownerId) match.ownerId = ownerId;

    const result = await TransactionModel.aggregate([
        { $match: match },
        { $group: { _id: null, totalSold: { $sum: '$orderQuantity' } } }
    ]);

    return result.length > 0 ? result[0].totalSold : 0;
};

/**
 * Calculate total stock sold for multiple variant codes in a single aggregation.
 *
 * Owner-scoped only (see note on getStockTerjual above).
 *
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {Array<string>} codes - Array of product variant codes
 * @returns {Promise<Map<string, number>>} - Map of code → total quantity sold
 */
const getStockTerjualBatch = async (context, codes) => {
    const match = {
        productCode: { $in: codes },
        isSuccess: true,
        isCanceled: false,
        $or: [
            { transaction_type: 'product' },
            { transaction_type: { $exists: false } }
        ]
    };
    const ownerId = context?.ownerId ?? null;
    if (ownerId) match.ownerId = ownerId;

    const results = await TransactionModel.aggregate([
        { $match: match },
        { $group: { _id: '$productCode', totalSold: { $sum: '$orderQuantity' } } }
    ]);

    const map = new Map();
    for (const r of results) {
        map.set(r._id, r.totalSold);
    }
    return map;
};

module.exports = {
    getStockTerjual,
    getStockTerjualBatch
};
