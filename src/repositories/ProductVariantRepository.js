const BaseRepository = require('./BaseRepository');
const ProductVariantModel = require('../database/models/productsVariantModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Product Variant Repository
 * Handles product variant CRUD with owner-level isolation
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - Variants are shared across all bots owned by the same owner
 * - Filter by ownerId in MULTI mode
 * - No filtering in SINGLE mode
 *
 * Case-insensitive fields: codeVariant
 * - All codeVariant lookups are case-insensitive (normalized to lowercase)
 */
class ProductVariantRepository extends BaseRepository {
    constructor() {
        super(ProductVariantModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['codeVariant']
        });
    }

    /**
     * Find variant by codeVariant (case-insensitive)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - Variant document
     */
    async findByCodeVariant(context, codeVariant) {
        return await this.findOne(context, { codeVariant });
    }

    /**
     * Find all variants for a product
     * @param {Object} context - Repository context
     * @param {number} productCode - Product code
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of variants
     */
    async findByProductCode(context, productCode, options = {}) {
        const defaultOptions = { sort: { codeVariant: 1 }, ...options };
        return await this.find(context, { code: productCode }, defaultOptions);
    }

    /**
     * Find active variants for a product
     * @param {Object} context - Repository context
     * @param {number} productCode - Product code
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of active variants
     */
    async findActiveVariantsByProduct(context, productCode, options = {}) {
        const defaultOptions = { sort: { codeVariant: 1 }, ...options };
        return await this.find(
            context,
            { code: productCode, isActive: true },
            defaultOptions
        );
    }

    /**
     * Find all active variants
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of active variants
     */
    async findActiveVariants(context, options = {}) {
        const defaultOptions = { sort: { code: 1, codeVariant: 1 }, ...options };
        return await this.find(context, { isActive: true }, defaultOptions);
    }

    /**
     * Update variant price (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {number} price - New price
     * @returns {Promise<Object>} - Update result
     */
    async updatePrice(context, codeVariant, price) {
        return await this.updateOne(context, { codeVariant }, { $set: { price } });
    }

    /**
     * Toggle variant active status (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {boolean} isActive - New status
     * @returns {Promise<Object>} - Update result
     */
    async setActiveStatus(context, codeVariant, isActive) {
        return await this.updateOne(context, { codeVariant }, { $set: { isActive } });
    }

    /**
     * Activate variant
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Update result
     */
    async activateVariant(context, codeVariant) {
        return await this.setActiveStatus(context, codeVariant, true);
    }

    /**
     * Deactivate variant
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Update result
     */
    async deactivateVariant(context, codeVariant) {
        return await this.setActiveStatus(context, codeVariant, false);
    }

    /**
     * Delete variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteVariant(context, codeVariant) {
        return await this.deleteOne(context, { codeVariant });
    }

    /**
     * Delete all variants for a product (cascade delete)
     * @param {Object} context - Repository context
     * @param {number} productCode - Product code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteVariantsByProduct(context, productCode) {
        return await this.deleteMany(context, { code: productCode });
    }

    /**
     * Update product code for all variants (for re-numbering)
     * @param {Object} context - Repository context
     * @param {number} oldCode - Old product code
     * @param {number} newCode - New product code
     * @returns {Promise<Object>} - Update result
     */
    async updateProductCodeForVariants(context, oldCode, newCode) {
        return await this.updateMany(context, { code: oldCode }, { $set: { code: newCode } });
    }

    /**
     * Count variants for a product
     * @param {Object} context - Repository context
     * @param {number} productCode - Product code
     * @param {boolean} activeOnly - Count only active variants
     * @returns {Promise<number>} - Variant count
     */
    async countVariantsByProduct(context, productCode, activeOnly = false) {
        const filter = { code: productCode };
        if (activeOnly) {
            filter.isActive = true;
        }
        return await this.count(context, filter);
    }

    /**
     * Check if variant with codeVariant exists (case-insensitive)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<boolean>} - True if exists
     */
    async existsByCodeVariant(context, codeVariant) {
        return await this.exists(context, { codeVariant });
    }

    /**
     * Find platform variant (ownerId=null) — bypasses OwnerScoped isolation
     * Used for reseller orders to look up platform product variants
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - Platform variant document or null
     */
    async findPlatformVariant(codeVariant) {
        const normalizedCode = this._normalizeValue(codeVariant);
        return await this.model.findOne({ codeVariant: normalizedCode, ownerId: null }).lean();
    }

    /**
     * Find multiple platform variants by codeVariant (ownerId=null) — batch lookup
     * Used for reseller orders to look up multiple platform product variants at once
     * @param {Array<string>} codeVariants - Array of variant codes
     * @returns {Promise<Array>} - Array of platform variant documents
     */
    async findPlatformVariants(codeVariants) {
        const normalized = codeVariants.map(cv => this._normalizeValue(cv));
        return await this.model.find({ codeVariant: { $in: normalized }, ownerId: null }).lean();
    }

    /**
     * Set is_cyclable flag for a variant
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {boolean} isCyclable - New value
     * @returns {Promise<Object>} - updateResult
     */
    async setCyclable(context, codeVariant, isCyclable) {
        return await this.updateOne(context, { codeVariant }, { $set: { is_cyclable: isCyclable } });
    }

    /**
     * Set duration_days for a variant
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {number|null} durationDays - Duration in days (null to clear)
     * @returns {Promise<Object>} - updateResult
     */
    async setDuration(context, codeVariant, durationDays) {
        return await this.updateOne(context, { codeVariant }, { $set: { duration_days: durationDays } });
    }

    async addTierPricing(context, codeVariant, minQty, price) {
        await this.updateOne(context, { codeVariant }, { $pull: { tier_pricing: { min_qty: minQty } } });
        return this.updateOne(context, { codeVariant }, {
            $push: { tier_pricing: { $each: [{ min_qty: minQty, price }], $sort: { min_qty: 1 } } }
        });
    }

    async removeTierPricing(context, codeVariant, minQty) {
        return this.updateOne(context, { codeVariant }, { $pull: { tier_pricing: { min_qty: minQty } } });
    }

    async clearTierPricing(context, codeVariant) {
        return this.updateOne(context, { codeVariant }, { $set: { tier_pricing: [] } });
    }

    /**
     * Find variant by name (case-insensitive regex search)
     * @param {Object} context - Repository context
     * @param {string} name - Variant name (or partial name)
     * @param {number} productCode - Optional: filter by product code
     * @returns {Promise<Array>} - Array of matching variants
     */
    async findByName(context, name, productCode = null) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedName, 'i');
        const filter = { name: regex };

        if (productCode !== null) {
            filter.code = productCode;
        }

        return await this.find(context, filter);
    }
}

module.exports = new ProductVariantRepository();
