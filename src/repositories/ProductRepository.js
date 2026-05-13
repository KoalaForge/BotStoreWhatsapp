const BaseRepository = require('./BaseRepository');
const ProductModel = require('../database/models/productsModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Product Repository
 * Handles product CRUD with owner-level isolation
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - Products are shared across all bots owned by the same owner
 * - Filter by ownerId in MULTI mode
 * - No filtering in SINGLE mode
 *
 * Case-insensitive fields: code
 * - All code lookups are case-insensitive (normalized to lowercase)
 */
class ProductRepository extends BaseRepository {
    constructor() {
        // Products are OwnerScoped (shared across owner's bots)
        super(ProductModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['code']
        });
    }

    /**
     * Find product by code
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @returns {Promise<Object|null>} - Product document
     */
    async findByCode(context, code) {
        return await this.findOne(context, { code });
    }

    /**
     * Find active products
     * @param {Object} context - Repository context
     * @param {Object} options - Query options (sort, limit, etc.)
     * @returns {Promise<Array>} - Array of active products
     */
    async findActiveProducts(context, options = {}) {
        const defaultOptions = { sort: { code: 1 }, ...options };
        return await this.find(context, { isActive: true }, defaultOptions);
    }

    /**
     * Find all products (active and inactive)
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of products
     */
    async findAllProducts(context, options = {}) {
        const defaultOptions = { sort: { code: 1 }, ...options };
        return await this.find(context, {}, defaultOptions);
    }

    /**
     * Get next available product code
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Next code
     */
    async getNextCode(context) {
        const products = await this.find(context, {}, { sort: { code: -1 }, limit: 1 });
        return products.length > 0 ? products[0].code + 1 : 1;
    }

    /**
     * Toggle product active status
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @param {boolean} isActive - New status
     * @returns {Promise<Object>} - Update result
     */
    async setActiveStatus(context, code, isActive) {
        return await this.updateOne(context, { code }, { $set: { isActive } });
    }

    /**
     * Activate product
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @returns {Promise<Object>} - Update result
     */
    async activateProduct(context, code) {
        return await this.setActiveStatus(context, code, true);
    }

    /**
     * Deactivate product
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @returns {Promise<Object>} - Update result
     */
    async deactivateProduct(context, code) {
        return await this.setActiveStatus(context, code, false);
    }

    /**
     * Delete product (Note: cascade delete for variants should be handled by service layer)
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteProduct(context, code) {
        return await this.deleteOne(context, { code });
    }

    /**
     * Update product code (for re-numbering after deletion)
     * @param {Object} context - Repository context
     * @param {number} oldCode - Old code
     * @param {number} newCode - New code
     * @returns {Promise<Object>} - Update result
     */
    async updateProductCode(context, oldCode, newCode) {
        return await this.updateOne(context, { code: oldCode }, { $set: { code: newCode } });
    }

    /**
     * Count total products
     * @param {Object} context - Repository context
     * @param {boolean} activeOnly - Count only active products
     * @returns {Promise<number>} - Product count
     */
    async countProducts(context, activeOnly = false) {
        const filter = activeOnly ? { isActive: true } : {};
        return await this.count(context, filter);
    }

    /**
     * Check if product with code exists
     * @param {Object} context - Repository context
     * @param {number} code - Product code
     * @returns {Promise<boolean>} - True if exists
     */
    async existsByCode(context, code) {
        return await this.exists(context, { code });
    }

    /**
     * Find product by name (case-insensitive regex search)
     * @param {Object} context - Repository context
     * @param {string} name - Product name (or partial name)
     * @returns {Promise<Array>} - Array of matching products
     */
    async findByName(context, name) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedName, 'i');
        return await this.find(context, { name: regex });
    }
}

module.exports = new ProductRepository();
