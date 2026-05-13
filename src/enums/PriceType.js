/**
 * PriceType Enum
 * Defines the types of price modifiers for role-based pricing
 *
 * - FIXED: Add/subtract a fixed amount from base price
 *   Example: base price 50000, value -5000 = 45000
 *
 * - PERCENTAGE: Add/subtract a percentage of base price
 *   Example: base price 50000, value -15 (%) = 42500
 */
const PriceType = Object.freeze({
    FIXED: 'fixed',
    PERCENTAGE: 'percentage',

    /**
     * Get all valid price type values
     * @returns {string[]} Array of price type values
     */
    values() {
        return [this.FIXED, this.PERCENTAGE];
    },

    /**
     * Check if a value is a valid price type
     * @param {string} value - Value to check
     * @returns {boolean} True if valid
     */
    isValid(value) {
        return this.values().includes(value);
    }
});

module.exports = PriceType;
