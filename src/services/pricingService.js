const roleService = require('./roleService');
const modeService = require('./modeService');
const PriceType = require('../enums/PriceType');

/**
 * Pricing Service
 * Calculates role-based pricing for product variants
 *
 * Responsibility:
 * - Calculate price based on owner's role (MULTI mode only)
 * - Apply fixed or percentage modifiers
 * - Handle fallback to base price when role_pricing not configured
 * - Return base price in SINGLE mode (role pricing disabled)
 */
class PricingService {
    /**
     * Calculate price for a variant based on owner's role
     * @param {Object} variant - ProductVariant document with role_pricing
     * @param {string} ownerId - Bot owner's MongoDB ObjectId as string
     * @returns {Promise<number>} - Calculated price
     */
    async calculatePrice(variant, ownerId) {
        // Ensure price is numeric (prevent string values from DB causing concatenation bugs)
        const basePrice = Number(variant.price) || 0;

        // Role pricing is disabled in SINGLE mode - always return base price
        if (modeService.isSingleMode()) {
            return basePrice;
        }

        // If no role_pricing configured, return base price
        if (!variant.role_pricing) {
            return basePrice;
        }

        // Get owner's role
        const role = await roleService.getUserRole(ownerId);

        return this.calculatePriceForRole(variant, role);
    }

    /**
     * Calculate price for a specific role (sync version)
     * Useful when role is already known
     * @param {Object} variant - ProductVariant document with role_pricing
     * @param {string} role - Role name (Explorer, Connector, Provider)
     * @returns {number} - Calculated price
     */
    calculatePriceForRole(variant, role) {
        // Ensure price is numeric (prevent string values from DB causing concatenation bugs)
        const basePrice = Number(variant.price) || 0;

        // If no role_pricing configured, return base price
        if (!variant.role_pricing) {
            return basePrice;
        }

        // Parse role_pricing if it's stored as JSON string (common from Laravel backend)
        let rolePricingMap = variant.role_pricing;
        if (typeof rolePricingMap === 'string') {
            try {
                rolePricingMap = JSON.parse(rolePricingMap);
            } catch (e) {
                console.warn(`[PricingService] Failed to parse role_pricing JSON for variant ${variant.codeVariant}:`, e.message);
                return basePrice;
            }
        }

        // Get role-specific pricing config
        // Handle both Map and plain object
        let rolePricing;
        if (rolePricingMap instanceof Map) {
            rolePricing = rolePricingMap.get(role);
        } else {
            rolePricing = rolePricingMap[role];
        }

        // If role not in pricing map or value is 0, return base price
        if (!rolePricing || rolePricing.value === 0) {
            return basePrice;
        }

        return this._applyModifier(basePrice, rolePricing.type, rolePricing.value);
    }

    /**
     * Apply price modifier
     * @param {number} basePrice - Original price
     * @param {string} type - 'fixed' or 'percentage'
     * @param {number} value - Modifier value (can be negative for discount)
     * @returns {number} - Modified price (minimum 0)
     * @private
     */
    _applyModifier(basePrice, type, value) {
        // Ensure numeric types to prevent string concatenation
        const numericBasePrice = Number(basePrice) || 0;
        const numericValue = Number(value) || 0;
        let result = numericBasePrice;

        if (type === PriceType.FIXED) {
            // Fixed modifier: add/subtract exact amount
            // Example: basePrice 50000, value -5000 = 45000
            result = numericBasePrice + numericValue;
        } else if (type === PriceType.PERCENTAGE) {
            // Percentage modifier: add/subtract percentage of base price
            // Example: basePrice 50000, value -15 = 50000 + (50000 * -15 / 100) = 42500
            result = numericBasePrice + (numericBasePrice * numericValue / 100);
        }

        // Floor at 0 (never negative price)
        return Math.max(0, Math.round(result));
    }

    /**
     * Find the highest qualifying tier for a given quantity.
     * Drops entries with min_qty < 2 or price < 1 (invalid per spec).
     * @param {Object} variant - ProductVariant with tier_pricing array
     * @param {number} quantity - Order quantity
     * @returns {{ min_qty: number, price: number } | null}
     */
    resolveTierPrice(variant, quantity) {
        const tiers = variant.tier_pricing;
        if (!tiers || tiers.length === 0) return null;

        const qty = Number(quantity) || 1;
        let best = null;

        for (const tier of tiers) {
            const minQty = parseInt(tier.min_qty, 10);
            const price = parseInt(tier.price, 10);
            if (minQty < 2 || price < 1) continue;
            if (qty >= minQty) {
                if (!best || minQty > best.min_qty) {
                    best = { min_qty: minQty, price };
                }
            }
        }

        return best;
    }

    /**
     * Return the active tier at qty, or null if below all tiers.
     */
    getApplicableTier(variant, quantity) {
        return this.resolveTierPrice(variant, quantity);
    }

    /**
     * Return the next tier above current quantity, for "buy X more to save" hint.
     * @returns {{ min_qty: number, price: number } | null}
     */
    getNextTier(variant, quantity) {
        const tiers = variant.tier_pricing;
        if (!tiers || tiers.length === 0) return null;

        const qty = Number(quantity) || 1;
        let next = null;

        for (const tier of tiers) {
            const minQty = parseInt(tier.min_qty, 10);
            const price = parseInt(tier.price, 10);
            if (minQty < 2 || price < 1) continue;
            if (minQty > qty) {
                if (!next || minQty < next.min_qty) {
                    next = { min_qty: minQty, price };
                }
            }
        }

        return next;
    }

    /**
     * Return valid display tiers — filtered (min_qty≥2, price≥1) and sorted asc.
     * @param {Object} variant - ProductVariant with tier_pricing array
     * @returns {{ min_qty: number, price: number }[]}
     */
    getDisplayTiers(variant) {
        return (variant.tier_pricing || [])
            .filter(t => parseInt(t.min_qty, 10) >= 2 && parseInt(t.price, 10) >= 1)
            .sort((a, b) => a.min_qty - b.min_qty);
    }

    /**
     * Qty-aware price calculation. Uses tier_pricing if qty qualifies, else variant.price.
     * In SINGLE mode returns tier/base without role lookup.
     * @param {Object} variant - ProductVariant document
     * @param {string} ownerId - Bot owner's MongoDB ObjectId
     * @param {number} quantity - Order quantity
     * @returns {Promise<number>}
     */
    async calculatePriceForQty(variant, ownerId, quantity) {
        const tier = this.resolveTierPrice(variant, quantity);
        const basePrice = tier ? tier.price : (Number(variant.price) || 0);

        if (modeService.isSingleMode()) return basePrice;
        if (!variant.role_pricing) return basePrice;

        const role = await roleService.getUserRole(ownerId);
        return this.calculatePriceForRole({ ...variant, price: basePrice }, role);
    }

    /**
     * Get all role prices for a variant (useful for admin display)
     * @param {Object} variant - ProductVariant document
     * @returns {Object} - { Explorer: price, Connector: price, Provider: price }
     */
    getAllRolePrices(variant) {
        const Role = require('../enums/Role');
        const prices = {};

        for (const role of Role.getPricingRoles()) {
            prices[role] = this.calculatePriceForRole(variant, role);
        }

        return prices;
    }
}

// Export singleton instance
module.exports = new PricingService();
