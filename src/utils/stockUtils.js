const transactionRepository = require('../repositories/TransactionRepository');

/**
 * Calculate total stock sold (quantity sum) for a product variant
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {string} code - Product variant code
 * @returns {Promise<number>} - Total quantity sold
 */
const getStockTerjual = async (context, code) => {
    const result = await transactionRepository.aggregate(context, [
        {
            $match: {
                productCode: code,
                isSuccess: true,
                isCanceled: false,
                $or: [
                    { transaction_type: 'product' },
                    { transaction_type: { $exists: false } }
                ]
            }
        },
        {
            $group: {
                _id: null,
                totalSold: { $sum: "$orderQuantity" }
            }
        }
    ]);

    return result.length > 0 ? result[0].totalSold : 0;
};

/**
 * Calculate total stock sold for multiple variant codes in a single aggregation
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {Array<string>} codes - Array of product variant codes
 * @returns {Promise<Map<string, number>>} - Map of code → total quantity sold
 */
const getStockTerjualBatch = async (context, codes) => {
    const results = await transactionRepository.aggregate(context, [
        {
            $match: {
                productCode: { $in: codes },
                isSuccess: true,
                isCanceled: false,
                $or: [
                    { transaction_type: 'product' },
                    { transaction_type: { $exists: false } }
                ]
            }
        },
        {
            $group: {
                _id: '$productCode',
                totalSold: { $sum: '$orderQuantity' }
            }
        }
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
