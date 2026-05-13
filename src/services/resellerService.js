const resellerVariantConfigRepository = require('../repositories/ResellerVariantConfigRepository');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const productRepository = require('../repositories/ProductRepository');
const stockRepository = require('../repositories/StockRepository');

/**
 * Reseller Service
 * Central coordination for reseller product logic:
 * - Detection of reseller products
 * - 2-layer pricing (rolePrice + markup)
 * - Platform variant resolution
 * - Display list building
 */
class ResellerService {
    /**
     * Check if a product is a reseller product
     * @param {Object} product - Product document
     * @returns {boolean}
     */
    isResellerProduct(product) {
        return !!product.reseller_source_code;
    }

    /**
     * Get active variant configs for a reseller product
     * @param {Object} context - Repository context
     * @param {string} resellerProductCode - Reseller product code
     * @returns {Promise<Array>} - Active configs
     */
    async getVariantConfigs(context, resellerProductCode) {
        return await resellerVariantConfigRepository.findActiveByProductCode(context, resellerProductCode);
    }

    /**
     * Resolve platform variant from callback data (for showPesanan)
     * When OwnerScoped variant lookup misses, try to find as platform variant via config
     *
     * @param {Object} context - Repository context (reseller owner's context)
     * @param {string} platformVariantCode - The codeVariant from callback
     * @returns {Promise<Object|null>} - { platformVariant, config, resellerProduct } or null
     */
    async resolveVariantFromCallback(context, platformVariantCode) {
        // Find config that maps this platform variant to a reseller product
        const config = await resellerVariantConfigRepository.findByPlatformVariantCode(context, platformVariantCode);
        if (!config) return null;

        // Get the platform variant (bypass OwnerScoped — query with ownerId=null)
        const platformVariant = await productVariantRepository.findPlatformVariant(platformVariantCode);
        if (!platformVariant || !platformVariant.isActive) return null;

        // Get the reseller product (OwnerScoped — belongs to this owner)
        const resellerProduct = await productRepository.findByCode(context, config.product_code);
        if (!resellerProduct) return null;

        return { platformVariant, config, resellerProduct };
    }

    /**
     * Look up a direct price override for a specific tier min_qty in reseller config.
     * Checks both string key ("5") and integer key (5) per MongoDB storage variability.
     * @param {Object} config - ResellerVariantConfig document
     * @param {number} tierMinQty - The min_qty of the qualifying tier
     * @returns {number|null} - Override price if present and > 0, else null
     */
    resolveResellerOverride(config, tierMinQty) {
        const overrides = config.tier_overrides;
        if (!overrides || typeof overrides !== 'object') return null;

        const byString = parseInt(overrides[String(tierMinQty)], 10);
        if (byString > 0) return byString;

        const byInt = parseInt(overrides[tierMinQty], 10);
        if (byInt > 0) return byInt;

        return null;
    }

    /**
     * Apply reseller pricing (Layer 2): override takes priority, else markup.
     * @param {number} platformLayer1Price - Platform price after role (Layer 1)
     * @param {Object} config - ResellerVariantConfig document
     * @param {number|null} tierMinQtyOrNull - The min_qty of the active tier, or null if no tier active
     * @returns {{ price: number, isOverride: boolean }}
     */
    applyResellerPricing(platformLayer1Price, config, tierMinQtyOrNull) {
        if (tierMinQtyOrNull != null) {
            const override = this.resolveResellerOverride(config, tierMinQtyOrNull);
            if (override) return { price: override, isOverride: true };
        }
        return {
            price: this.calculateMarkup(platformLayer1Price, config.markup_type, config.markup_value),
            isOverride: false
        };
    }

    /**
     * Calculate markup on top of buy price
     * @param {number} buyPrice - Base price after role pricing (Layer 1)
     * @param {string} markupType - 'fixed' or 'percentage'
     * @param {number} markupValue - Markup amount or percentage
     * @returns {number} - Final sell price (Layer 2)
     */
    calculateMarkup(buyPrice, markupType, markupValue) {
        // Ensure buyPrice is numeric to prevent string concatenation (e.g., "8000" + 5000 = "80005000")
        const numericBuyPrice = Number(buyPrice) || 0;
        const numericMarkupValue = Number(markupValue) || 0;

        if (markupType === 'percentage') {
            return numericBuyPrice + Math.round(numericBuyPrice * numericMarkupValue / 100);
        }
        // fixed - ensure numeric addition, not string concatenation
        return numericBuyPrice + numericMarkupValue;
    }

    /**
     * Build variant display list for handleProductList
     * Returns array of display data for each active config
     *
     * @param {Object} context - Repository context (reseller owner's context)
     * @param {Object} resellerProduct - Reseller product document
     * @param {string} ownerId - Owner ID for role-based pricing
     * @param {Object} pricingService - Pricing service instance
     * @returns {Promise<Array>} - Array of { displayName, sellPrice, platformVariantCode, platformStockCount, platformVariant, tiers }
     */
    async buildVariantDisplayList(context, resellerProduct, ownerId, pricingService) {
        const configs = await this.getVariantConfigs(context, resellerProduct.code);
        if (configs.length === 0) return [];

        const platformVariantCodes = configs.map(c => c.platform_variant_code);
        const [platformVariants, stockMap] = await Promise.all([
            productVariantRepository.findPlatformVariants(platformVariantCodes),
            stockRepository.countPlatformStockBatch(platformVariantCodes)
        ]);

        // Build lookup map for O(1) access
        const variantMap = new Map();
        for (const v of platformVariants) {
            variantMap.set(v.codeVariant, v);
        }

        // Filter to active variants
        const activeConfigs = [];
        const activeVariants = [];
        for (const config of configs) {
            const normalizedCode = config.platform_variant_code?.toLowerCase?.() ?? config.platform_variant_code;
            const pv = variantMap.get(normalizedCode);
            if (!pv || !pv.isActive) continue;
            activeConfigs.push(config);
            activeVariants.push(pv);
        }

        const tiersTasks = activeConfigs.map((config, i) => {
            const pv = activeVariants[i];
            const rawTiers = pricingService.getDisplayTiers(pv);
            if (rawTiers.length === 0) return Promise.resolve(null);
            return Promise.all(rawTiers.map(t => {
                const minQty = parseInt(t.min_qty, 10);
                return pricingService.calculatePriceForQty(pv, ownerId, minQty).then(rolePrice => {
                    const { price } = this.applyResellerPricing(rolePrice, config, minQty);
                    return { minQty, tierUnitPrice: price };
                });
            }));
        });

        const [prices, tiersPerVariant] = await Promise.all([
            Promise.all(activeVariants.map(pv => pricingService.calculatePrice(pv, ownerId))),
            Promise.all(tiersTasks)
        ]);

        const displayList = [];
        for (let i = 0; i < activeConfigs.length; i++) {
            const config = activeConfigs[i];
            const pv = activeVariants[i];
            const sellPrice = this.calculateMarkup(prices[i], config.markup_type, config.markup_value);
            displayList.push({
                displayName: config.custom_name || pv.name,
                sellPrice,
                platformVariantCode: pv.codeVariant,
                platformStockCount: stockMap.get(pv.codeVariant) || 0,
                platformVariant: pv,
                tiers: tiersPerVariant[i] || null
            });
        }

        return displayList;
    }
}

module.exports = new ResellerService();
