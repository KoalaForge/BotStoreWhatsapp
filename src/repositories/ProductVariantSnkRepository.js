const BaseRepository = require('./BaseRepository');
const ProductVariantSnkModel = require('../database/models/productVariantSnkModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Product Variant SNK (Terms & Conditions) Repository
 * Handles SNK CRUD with owner-level isolation
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - SNK are shared across all bots owned by the same owner
 * - Filter by ownerId in MULTI mode
 * - No filtering in SINGLE mode
 *
 * Case-insensitive fields: codeVariant
 * - All codeVariant lookups are case-insensitive (normalized to lowercase)
 */
class ProductVariantSnkRepository extends BaseRepository {
    constructor() {
        super(ProductVariantSnkModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['codeVariant']
        });
    }

    /**
     * Find SNK by codeVariant (case-insensitive)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - SNK document
     */
    async findByCodeVariant(context, codeVariant) {
        return await this.findOne(context, { codeVariant });
    }

    /**
     * Create or update SNK for a variant (upsert pattern, normalizes codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {string} termsAndConditions - Syarat & Ketentuan
     * @param {string} warrantyTerms - Ketentuan Garansi
     * @returns {Promise<Object>} - Created/updated SNK document
     */
    async upsertSnk(context, codeVariant, termsAndConditions, warrantyTerms = '') {
        // Delete existing SNK if any
        await this.deleteSnk(context, codeVariant);

        // Create new SNK with new schema
        return await this.create(context, {
            codeVariant,
            termsAndConditions,
            warrantyTerms
        });
    }

    /**
     * Legacy method for backward compatibility - maps content to termsAndConditions
     * @deprecated Use upsertSnk with termsAndConditions and warrantyTerms instead
     */
    async upsertSnkLegacy(context, codeVariant, content) {
        await this.deleteSnk(context, codeVariant);
        return await this.create(context, {
            codeVariant,
            termsAndConditions: content,
            warrantyTerms: ''
        });
    }

    /**
     * Delete SNK for a variant (case-insensitive codeVariant)
     * Alias for deleteByCodeVariant for backward compatibility
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteSnk(context, codeVariant) {
        return await this.deleteByCodeVariant(context, codeVariant);
    }

    /**
     * Delete SNK for a variant (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - Delete result
     */
    async deleteByCodeVariant(context, codeVariant) {
        return await this.deleteOne(context, { codeVariant });
    }

    /**
     * Check if SNK exists for a variant (case-insensitive)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<boolean>} - True if exists
     */
    async existsByCodeVariant(context, codeVariant) {
        return await this.exists(context, { codeVariant });
    }

    /**
     * Find all SNK
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of SNK documents
     */
    async findAllSnk(context, options = {}) {
        const defaultOptions = { sort: { codeVariant: 1 }, ...options };
        return await this.find(context, {}, defaultOptions);
    }

    /**
     * Count total SNK
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - SNK count
     */
    async countSnk(context) {
        return await this.count(context, {});
    }

    /**
     * Update SNK fields (case-insensitive codeVariant)
     * @param {Object} context - Repository context
     * @param {string} codeVariant - Variant code
     * @param {string} termsAndConditions - Syarat & Ketentuan
     * @param {string} warrantyTerms - Ketentuan Garansi
     * @returns {Promise<Object>} - Update result
     */
    async updateSnkFields(context, codeVariant, termsAndConditions, warrantyTerms = null) {
        const updateData = { termsAndConditions };
        if (warrantyTerms !== null) {
            updateData.warrantyTerms = warrantyTerms;
        }
        return await this.updateOne(context, { codeVariant }, { $set: updateData });
    }

    /**
     * Legacy method for backward compatibility
     * @deprecated Use updateSnkFields instead
     */
    async updateContent(context, codeVariant, content) {
        return await this.updateOne(context, { codeVariant }, { $set: { termsAndConditions: content } });
    }
}

module.exports = new ProductVariantSnkRepository();
