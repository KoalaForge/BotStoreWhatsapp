const BaseRepository = require('./BaseRepository');
const StockModel = require('../database/models/stockModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Stock Repository
 * Handles stock CRUD with owner-level isolation
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - Stock is shared across all bots owned by the same owner
 * - Filter by ownerId in MULTI mode
 * - No filtering in SINGLE mode
 *
 * Case-insensitive fields: codeVariant
 * - All codeVariant lookups are case-insensitive (normalized to lowercase)
 */
class StockRepository extends BaseRepository {
    constructor() {
        super(StockModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['codeVariant']
        });
    }

    /**
     * Find all stock for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of stock items
     */
    async findByCodeVariant(context, codeVariant, options = {}) {
        const defaultOptions = { sort: { createdAt: 1 }, ...options };
        return await this.find(context, { codeVariant }, defaultOptions);
    }

    /**
     * Count available stock for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Stock count
     */
    async countStock(context, codeVariant) {
        return await this.count(context, { codeVariant });
    }

    /**
     * Add stock item (normalizes codeVariant to lowercase)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {string} dataStock - Stock data (e.g., serial number, code)
     * @param {number} profit - Profit amount
     * @param {Date|null} expires_at - Expiry date for cyclable stock (null = no expiry)
     * @returns {Promise<Object>} - Created stock document
     */
    async addStock(context, codeVariant, dataStock, profit = 0, expires_at = null) {
        const doc = { codeVariant, dataStock, profit };
        if (expires_at) doc.expires_at = expires_at;
        return await this.create(context, doc);
    }

    /**
     * Add multiple stock items
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {Array<string>} stockDataArray - Array of stock data
     * @param {number} profit - Profit amount (same for all)
     * @returns {Promise<Array>} - Array of created stock documents
     */
    async addMultipleStocks(context, codeVariant, stockDataArray, profit = 0) {
        const stockPromises = stockDataArray.map(dataStock =>
            this.addStock(context, codeVariant, dataStock, profit)
        );
        return await Promise.all(stockPromises);
    }

    /**
     * Remove stock by dataStock value
     * @param {Object} context - Repository context
     * @param {string} dataStock - Stock data to remove
     * @returns {Promise<Object>} - Delete result
     */
    async removeStockByData(context, dataStock) {
        return await this.deleteOne(context, { dataStock });
    }

    /**
     * Remove stock by codeVariant and dataStock (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {string} dataStock - Stock data to remove
     * @returns {Promise<Object>} - Delete result
     */
    async removeStock(context, codeVariant, dataStock) {
        return await this.deleteOne(context, { codeVariant, dataStock });
    }

    /**
     * Get first available stock (FIFO - First In First Out, case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - First stock item or null
     */
    async getFirstAvailableStock(context, codeVariant) {
        const stocks = await this.find(context, { codeVariant }, { sort: { createdAt: 1 }, limit: 1 });
        return stocks.length > 0 ? stocks[0] : null;
    }

    /**
     * Pull stock (get and remove first available)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - Pulled stock item or null if no stock available
     */
    async pullStock(context, codeVariant) {
        const stock = await this.getFirstAvailableStock(context, codeVariant);

        if (stock) {
            await this.deleteOne(context, { _id: stock._id });
        }

        return stock;
    }

    /**
     * Pull multiple stocks (batch find + deleteMany — 2 queries instead of 2N)
     * Safe for admin pullstock operations where strict per-item atomicity isn't required.
     * Customer orders still use the atomic pullStock() method.
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {number} quantity - Number of stocks to pull
     * @returns {Promise<Array>} - Array of pulled stock items
     */
    async pullMultipleStocks(context, codeVariant, quantity) {
        // Batch find the first N items (FIFO by createdAt)
        const stocks = await this.find(context, { codeVariant }, {
            sort: { createdAt: 1 },
            limit: quantity
        });

        if (stocks.length === 0) return [];

        // Batch delete by IDs (single query)
        const stockIds = stocks.map(s => s._id);
        const deleteResult = await this.deleteMany(context, { _id: { $in: stockIds } });

        return stocks.slice(0, deleteResult.deletedCount);
    }

    /**
     * Delete all stock for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteAllStockByVariant(context, codeVariant) {
        return await this.deleteMany(context, { codeVariant });
    }

    /**
     * Check if stock is available
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {number} minQuantity - Minimum quantity required (default: 1)
     * @returns {Promise<boolean>} - True if enough stock available
     */
    async hasStock(context, codeVariant, minQuantity = 1) {
        const count = await this.countStock(context, codeVariant);
        return count >= minQuantity;
    }

    // ============================================
    // PLATFORM STOCK METHODS (bypass OwnerScoped)
    // Used for reseller orders — platform stock has ownerId=null
    // ============================================

    /**
     * Find available platform stock for a variant (ownerId=null)
     * @param {string} codeVariant - Variant code
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of platform stock items
     */
    async findPlatformStock(codeVariant, options = {}) {
        const normalizedCode = this._normalizeValue(codeVariant);
        const defaultOptions = { sort: { createdAt: 1 }, ...options };

        let query = this.model.find({ codeVariant: normalizedCode, ownerId: null });
        if (defaultOptions.sort) query = query.sort(defaultOptions.sort);
        if (defaultOptions.limit) query = query.limit(defaultOptions.limit);
        return await query.exec();
    }

    /**
     * Count available platform stock for a variant (ownerId=null)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Stock count
     */
    async countPlatformStock(codeVariant) {
        const normalizedCode = this._normalizeValue(codeVariant);
        return await this.model.countDocuments({ codeVariant: normalizedCode, ownerId: null });
    }

    /**
     * Delete a specific platform stock item by _id
     * Used for race-condition-safe stock consumption
     * @param {string} stockId - Stock document _id
     * @returns {Promise<Object>} - Delete result (check deletedCount for race condition)
     */
    async deletePlatformStockById(stockId) {
        return await this.model.deleteOne({ _id: stockId, ownerId: null });
    }

    /**
     * Add platform stock item (ownerId=null) — used for stock restoration on cancel
     * @param {string} codeVariant - Variant code
     * @param {string} dataStock - Stock data
     * @param {number} profit - Profit amount
     * @param {Date|null} expires_at - Expiry date for cyclable stock (null = no expiry)
     * @returns {Promise<Object>} - Created stock document
     */
    async addPlatformStock(codeVariant, dataStock, profit = 0, expires_at = null) {
        const normalizedCode = this._normalizeValue(codeVariant);
        const doc = { codeVariant: normalizedCode, dataStock, profit, ownerId: null };
        if (expires_at) doc.expires_at = expires_at;
        const document = new this.model(doc);
        return await document.save();
    }

    /**
     * Count stock for multiple variants in a single aggregation query
     * @param {Object} context - Repository context
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Map<string, number>>} - Map of codeVariant → stock count
     */
    async countStockBatch(context, codeVariants) {
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.aggregate(context, [
            { $match: { codeVariant: { $in: normalized } } },
            { $group: { _id: '$codeVariant', count: { $sum: 1 } } }
        ]);
        const map = new Map();
        for (const r of results) {
            map.set(r._id, r.count);
        }
        return map;
    }

    /**
     * Count platform stock for multiple variants in a single aggregation (ownerId=null)
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Map<string, number>>} - Map of codeVariant → stock count
     */
    async countPlatformStockBatch(codeVariants) {
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.model.aggregate([
            { $match: { codeVariant: { $in: normalized }, ownerId: null } },
            { $group: { _id: '$codeVariant', count: { $sum: 1 } } }
        ]);
        const map = new Map();
        for (const r of results) {
            map.set(r._id, r.count);
        }
        return map;
    }

    /**
     * Get stock statistics for a variant
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Stock statistics
     */
    async getStockStats(context, codeVariant) {
        const stocks = await this.findByCodeVariant(context, codeVariant);

        const totalStock = stocks.length;
        const totalProfit = stocks.reduce((sum, stock) => sum + (stock.profit || 0), 0);
        const averageProfit = totalStock > 0 ? totalProfit / totalStock : 0;

        return {
            totalStock,
            totalProfit,
            averageProfit
        };
    }
}

module.exports = new StockRepository();
