const BaseRepository = require('./BaseRepository');
const StockModel = require('../database/models/stockModels');
const StockBatchModel = require('../database/models/stockBatchModels');
const IsolationStrategy = require('./IsolationStrategy');
const { randomUUID } = require('crypto');

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

    _availabilityFilter() {
        return {
            $or: [
                { stockSchemaVersion: { $exists: false }, soldAt: null },
                { stockSchemaVersion: { $lt: 2 }, soldAt: null },
                { stockSchemaVersion: 2, stockState: 'available' }
            ]
        };
    }

    _withAvailabilityFilter(filter = {}) {
        return { $and: [filter, this._availabilityFilter()] };
    }

    async _releaseExpiredReservations(context, ownerFilter = {}) {
        const resolvedContext = await this._ensureContext(context);
        const scopedFilter = this._buildFilter(resolvedContext, ownerFilter);

        return await this.model.updateMany(
            {
                ...scopedFilter,
                stockSchemaVersion: 2,
                stockState: 'reserved',
                reservationExpiresAt: { $lte: new Date() }
            },
            {
                $set: { stockState: 'available', availableAt: new Date() },
                $inc: { stateRevision: 1 },
                $unset: { reservationToken: 1, reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
    }

    async createStockBatch(context, codeVariant, profitPerUnit, quantityAdded) {
        const batchCode = `WA-${randomUUID()}`;
        const data = this._buildData(context, {
            _id: batchCode,
            batchCode,
            codeVariant: this._normalizeValue(codeVariant),
            profitPerUnit,
            quantityAdded,
            sourceSystem: 'orkut-whatsapp',
            status: 'completed'
        });

        await StockBatchModel.create(data);
        return batchCode;
    }

    async claimStock(context, codeVariant, reservation) {
        const resolvedContext = await this._ensureContext(context);
        const normalizedCode = this._normalizeValue(codeVariant);
        const ownerFilter = this._buildFilter(resolvedContext, { codeVariant: normalizedCode });
        const tracked = await this.model.findOneAndUpdate(
            {
                ...ownerFilter,
                stockSchemaVersion: 2,
                stockState: 'available'
            },
            {
                $set: {
                    stockState: 'reserved',
                    reservationToken: reservation.token,
                    reservedTransactionId: reservation.transactionId ?? null,
                    reservedOrderItemId: reservation.orderItemId ?? null,
                    reservedAt: new Date(),
                    reservationExpiresAt: reservation.expiresAt ?? null
                },
                $inc: { stateRevision: 1 }
            },
            { sort: { availableAt: 1, createdAt: 1, _id: 1 }, new: true }
        );

        if (tracked) return tracked;

        return await this.model.findOneAndDelete(
            { ...ownerFilter, stockSchemaVersion: { $exists: false }, soldAt: null },
            { sort: { createdAt: 1, _id: 1 } }
        );
    }

    async releaseClaim(context, stockId, token) {
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { _id: stockId });
        return await this.model.updateOne(
            { ...ownerFilter, stockSchemaVersion: 2, stockState: 'reserved', reservationToken: token },
            {
                $set: { stockState: 'available', availableAt: new Date() },
                $inc: { stateRevision: 1 },
                $unset: { reservationToken: 1, reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
    }

    async finalizeClaim(context, stockId, token, transactionId, orderItemId = null) {
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { _id: stockId });
        return await this.model.updateOne(
            { ...ownerFilter, stockSchemaVersion: 2, stockState: 'reserved', reservationToken: token },
            {
                $set: { stockState: 'sold', soldAt: new Date(), soldTransactionId: transactionId, soldOrderItemId: orderItemId },
                $inc: { stateRevision: 1 },
                $unset: { reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
    }

    async cycleStock(context, stockId, token) {
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { _id: stockId });
        return await this.model.updateOne(
            { ...ownerFilter, stockSchemaVersion: 2, stockState: 'sold', reservationToken: token },
            {
                $set: { stockState: 'available', availableAt: new Date(), lastCycledAt: new Date() },
                $inc: { stateRevision: 1, cycleGeneration: 1 }
            }
        );
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
        return await this.find(context, this._withAvailabilityFilter({ codeVariant }), defaultOptions);
    }

    /**
     * Count available stock for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Stock count
     */
    async countStock(context, codeVariant) {
        await this._releaseExpiredReservations(context, { codeVariant: this._normalizeValue(codeVariant) });
        return await this.count(context, this._withAvailabilityFilter({ codeVariant }));
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
    async addStock(context, codeVariant, dataStock, profit = 0, expires_at = null, lineage = {}) {
        const doc = { codeVariant, dataStock, profit };
        if (expires_at) doc.expires_at = expires_at;
        Object.assign(doc, {
            unitCost: lineage.unitCost ?? null,
            stockBatchId: lineage.stockBatchId ?? null,
            stockOriginId: lineage.stockOriginId ?? randomUUID(),
            stockSchemaVersion: 2,
            stockState: 'available',
            stateRevision: 0,
            availableAt: new Date(),
            cycleGeneration: lineage.cycleGeneration ?? 0
        });
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
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { dataStock });
        const tracked = await this.model.findOneAndUpdate(
            { ...ownerFilter, stockSchemaVersion: 2, stockState: 'available' },
            { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } },
            { new: true }
        );

        if (tracked) return { acknowledged: true, deletedCount: 0, modifiedCount: 1, value: tracked };

        return await this.deleteOne(context, { dataStock, stockSchemaVersion: { $exists: false }, soldAt: null });
    }

    /**
     * Remove stock by codeVariant and dataStock (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {string} dataStock - Stock data to remove
     * @returns {Promise<Object>} - Delete result
     */
    async removeStock(context, codeVariant, dataStock) {
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { codeVariant, dataStock });
        const tracked = await this.model.findOneAndUpdate(
            { ...ownerFilter, stockSchemaVersion: 2, stockState: 'available' },
            { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } },
            { new: true }
        );

        if (tracked) return { acknowledged: true, deletedCount: 0, modifiedCount: 1, value: tracked };

        return await this.deleteOne(context, { codeVariant, dataStock, stockSchemaVersion: { $exists: false }, soldAt: null });
    }

    /**
     * Get first available stock (FIFO - First In First Out, case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - First stock item or null
     */
    async getFirstAvailableStock(context, codeVariant) {
        const stocks = await this.find(context, this._withAvailabilityFilter({ codeVariant }), { sort: { createdAt: 1 }, limit: 1 });
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
            if (stock.stockSchemaVersion === 2) {
                await this.model.updateOne(
                    { _id: stock._id, stockSchemaVersion: 2, stockState: 'available' },
                    { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } }
                );
            } else {
                await this.deleteOne(context, { _id: stock._id, stockSchemaVersion: { $exists: false }, soldAt: null });
            }
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
        const stocks = await this.find(context, this._withAvailabilityFilter({ codeVariant }), {
            sort: { createdAt: 1 },
            limit: quantity
        });

        if (stocks.length === 0) return [];

        // Batch delete by IDs (single query)
        const trackedIds = stocks.filter(s => s.stockSchemaVersion === 2).map(s => s._id);
        const legacyIds = stocks.filter(s => s.stockSchemaVersion !== 2).map(s => s._id);
        const trackedResult = trackedIds.length > 0
            ? await this.model.updateMany(
                { _id: { $in: trackedIds }, stockSchemaVersion: 2, stockState: 'available' },
                { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } }
            )
            : { modifiedCount: 0 };
        const legacyResult = legacyIds.length > 0
            ? await this.deleteMany(context, { _id: { $in: legacyIds }, stockSchemaVersion: { $exists: false }, soldAt: null })
            : { deletedCount: 0 };

        return stocks.slice(0, trackedResult.modifiedCount + legacyResult.deletedCount);
    }

    /**
     * Delete all stock for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteAllStockByVariant(context, codeVariant) {
        const resolvedContext = await this._ensureContext(context);
        const ownerFilter = this._buildFilter(resolvedContext, { codeVariant, stockSchemaVersion: 2, stockState: 'available' });
        const tracked = await this.model.updateMany(
            ownerFilter,
            { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } }
        );
        const legacy = await this.deleteMany(context, { codeVariant, stockSchemaVersion: { $exists: false }, soldAt: null });

        return { acknowledged: true, deletedCount: legacy.deletedCount, modifiedCount: tracked.modifiedCount };
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

        let query = this.model.find(this._withAvailabilityFilter({ codeVariant: normalizedCode, ownerId: null }));
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
        await this.model.updateMany(
            {
                ownerId: null,
                stockSchemaVersion: 2,
                stockState: 'reserved',
                reservationExpiresAt: { $lte: new Date() }
            },
            {
                $set: { stockState: 'available', availableAt: new Date() },
                $inc: { stateRevision: 1 },
                $unset: { reservationToken: 1, reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
        return await this.model.countDocuments(this._withAvailabilityFilter({ codeVariant: normalizedCode, ownerId: null }));
    }

    async claimPlatformStock(codeVariant, reservation) {
        const normalizedCode = this._normalizeValue(codeVariant);
        const filter = { codeVariant: normalizedCode, ownerId: null };
        const tracked = await this.model.findOneAndUpdate(
            {
                ...filter,
                stockSchemaVersion: 2,
                stockState: 'available'
            },
            {
                $set: {
                    stockState: 'reserved',
                    reservationToken: reservation.token,
                    reservedTransactionId: reservation.transactionId ?? null,
                    reservedOrderItemId: reservation.orderItemId ?? null,
                    reservedAt: new Date(),
                    reservationExpiresAt: reservation.expiresAt ?? null
                },
                $inc: { stateRevision: 1 }
            },
            { sort: { availableAt: 1, createdAt: 1, _id: 1 }, new: true }
        );

        if (tracked) return tracked;
        return await this.model.findOneAndDelete(
            { ...filter, stockSchemaVersion: { $exists: false }, soldAt: null },
            { sort: { createdAt: 1, _id: 1 } }
        );
    }

    async releasePlatformClaim(stockId, token) {
        return await this.model.updateOne(
            { _id: stockId, ownerId: null, stockSchemaVersion: 2, stockState: 'reserved', reservationToken: token },
            {
                $set: { stockState: 'available', availableAt: new Date() },
                $inc: { stateRevision: 1 },
                $unset: { reservationToken: 1, reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
    }

    async finalizePlatformClaim(stockId, token, transactionId, orderItemId = null) {
        return await this.model.updateOne(
            { _id: stockId, ownerId: null, stockSchemaVersion: 2, stockState: 'reserved', reservationToken: token },
            {
                $set: { stockState: 'sold', soldAt: new Date(), soldTransactionId: transactionId, soldOrderItemId: orderItemId },
                $inc: { stateRevision: 1 },
                $unset: { reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
    }

    async cyclePlatformStock(stockId, token) {
        return await this.model.updateOne(
            { _id: stockId, ownerId: null, stockSchemaVersion: 2, stockState: 'sold', reservationToken: token },
            {
                $set: { stockState: 'available', availableAt: new Date(), lastCycledAt: new Date() },
                $inc: { stateRevision: 1, cycleGeneration: 1 }
            }
        );
    }

    /**
     * Delete a specific platform stock item by _id
     * Used for race-condition-safe stock consumption
     * @param {string} stockId - Stock document _id
     * @returns {Promise<Object>} - Delete result (check deletedCount for race condition)
     */
    async deletePlatformStockById(stockId) {
        const tracked = await this.model.updateOne(
            { _id: stockId, ownerId: null, stockSchemaVersion: 2, stockState: 'available' },
            { $set: { stockState: 'removed', removedAt: new Date() }, $inc: { stateRevision: 1 } }
        );

        if (tracked.modifiedCount > 0) return { acknowledged: true, deletedCount: 0, modifiedCount: tracked.modifiedCount };

        return await this.model.deleteOne({ _id: stockId, ownerId: null, stockSchemaVersion: { $exists: false }, soldAt: null });
    }

    /**
     * Add platform stock item (ownerId=null) — used for stock restoration on cancel
     * @param {string} codeVariant - Variant code
     * @param {string} dataStock - Stock data
     * @param {number} profit - Profit amount
     * @param {Date|null} expires_at - Expiry date for cyclable stock (null = no expiry)
     * @returns {Promise<Object>} - Created stock document
     */
    async addPlatformStock(codeVariant, dataStock, profit = 0, expires_at = null, lineage = {}) {
        const normalizedCode = this._normalizeValue(codeVariant);
        const doc = {
            codeVariant: normalizedCode,
            dataStock,
            profit,
            ownerId: null,
            unitCost: lineage.unitCost ?? null,
            stockBatchId: lineage.stockBatchId ?? null,
            stockOriginId: lineage.stockOriginId ?? randomUUID(),
            stockSchemaVersion: 2,
            stockState: 'available',
            stateRevision: 0,
            availableAt: new Date(),
            cycleGeneration: lineage.cycleGeneration ?? 0
        };
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
        await this._releaseExpiredReservations(context);
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.aggregate(context, [
            { $match: this._withAvailabilityFilter({ codeVariant: { $in: normalized } }) },
            { $group: { _id: '$codeVariant', count: { $sum: 1 } } }
        ]);
        const map = new Map();
        for (const r of results) {
            map.set(r._id, r.count);
        }
        return map;
    }

    /**
     * Get latest stock entry createdAt per variant in a single aggregation.
     * Used as proxy for "last restock time" — each .addstock creates a new
     * stock_data_variants doc, so MAX(createdAt) per codeVariant = most recent restock.
     * @param {Object} context - Repository context
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Map<string, Date>>} - Map of codeVariant (normalized) → latest createdAt
     */
    async getLatestRestockBatch(context, codeVariants) {
        if (!codeVariants || codeVariants.length === 0) return new Map();
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.aggregate(context, [
            { $match: this._withAvailabilityFilter({ codeVariant: { $in: normalized } }) },
            { $group: { _id: '$codeVariant', latest: { $max: '$createdAt' } } }
        ]);
        const map = new Map();
        for (const r of results) {
            map.set(r._id, r.latest);
        }
        return map;
    }

    /**
     * Get latest stock entry createdAt per platform variant (ownerId=null).
     * Mirror of getLatestRestockBatch but for reseller/platform stock that is
     * shared across all bots (not owner-scoped).
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Map<string, Date>>} - Map of codeVariant → latest createdAt
     */
    async getLatestRestockBatchPlatform(codeVariants) {
        if (!codeVariants || codeVariants.length === 0) return new Map();
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.model.aggregate([
            { $match: this._withAvailabilityFilter({ codeVariant: { $in: normalized }, ownerId: null }) },
            { $group: { _id: '$codeVariant', latest: { $max: '$createdAt' } } }
        ]);
        const map = new Map();
        for (const r of results) {
            map.set(r._id, r.latest);
        }
        return map;
    }

    /**
     * Count platform stock for multiple variants in a single aggregation (ownerId=null)
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Map<string, number>>} - Map of codeVariant → stock count
     */
    async countPlatformStockBatch(codeVariants) {
        await this.model.updateMany(
            {
                ownerId: null,
                stockSchemaVersion: 2,
                stockState: 'reserved',
                reservationExpiresAt: { $lte: new Date() }
            },
            {
                $set: { stockState: 'available', availableAt: new Date() },
                $inc: { stateRevision: 1 },
                $unset: { reservationToken: 1, reservedTransactionId: 1, reservedOrderItemId: 1, reservedAt: 1, reservationExpiresAt: 1 }
            }
        );
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        const results = await this.model.aggregate([
            { $match: this._withAvailabilityFilter({ codeVariant: { $in: normalized }, ownerId: null }) },
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
