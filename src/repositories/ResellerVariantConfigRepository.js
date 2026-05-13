const BaseRepository = require('./BaseRepository');
const ResellerVariantConfigModel = require('../database/models/resellerVariantConfigModel');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Reseller Variant Config Repository
 * READ-ONLY collection managed by koalabotbe (Laravel)
 *
 * Isolation Strategy: IsolationStrategy.OwnerScoped
 * - Configs are scoped to the reseller (bot owner)
 * - Filter by ownerId in MULTI mode
 *
 * Case-insensitive fields: product_code, platform_variant_code
 */
class ResellerVariantConfigRepository extends BaseRepository {
    constructor() {
        super(ResellerVariantConfigModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['product_code', 'platform_variant_code']
        });
    }

    /**
     * Find all active configs for a reseller product code
     * @param {Object} context - Repository context
     * @param {string} productCode - Reseller product code
     * @returns {Promise<Array>} - Active configs
     */
    async findActiveByProductCode(context, productCode) {
        return await this.find(context, {
            product_code: productCode,
            is_active: true
        });
    }

    /**
     * Find config by platform variant code
     * @param {Object} context - Repository context
     * @param {string} platformVariantCode - Platform variant codeVariant
     * @returns {Promise<Object|null>} - Config or null
     */
    async findByPlatformVariantCode(context, platformVariantCode) {
        return await this.findOne(context, {
            platform_variant_code: platformVariantCode,
            is_active: true
        });
    }

    /**
     * Find specific config mapping
     * @param {Object} context - Repository context
     * @param {string} productCode - Reseller product code
     * @param {string} platformVariantCode - Platform variant codeVariant
     * @returns {Promise<Object|null>} - Config or null
     */
    async findConfig(context, productCode, platformVariantCode) {
        return await this.findOne(context, {
            product_code: productCode,
            platform_variant_code: platformVariantCode,
            is_active: true
        });
    }
}

module.exports = new ResellerVariantConfigRepository();
