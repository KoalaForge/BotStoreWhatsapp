/**
 * Isolation strategy constants for repository filtering
 * Uses Symbol for type-safety and prevents typos
 *
 * This module provides enum-like constants for defining how repositories
 * should filter data in MULTI mode based on botId and ownerId.
 *
 * Usage:
 *   const IsolationStrategy = require('./IsolationStrategy');
 *   new BaseRepository(model, IsolationStrategy.OwnerScoped);
 *
 * Benefits:
 *   - IDE autocomplete support
 *   - Typos caught immediately (undefined property access)
 *   - Symbol uniqueness prevents value collision
 *   - Backward compatible with string literals via fromString()
 */

// Create unique symbols for each strategy
const OWNER_SCOPED = Symbol('OWNER_SCOPED');
const BOT_SCOPED = Symbol('BOT_SCOPED');
const DUAL_SCOPED = Symbol('DUAL_SCOPED');
const NONE = Symbol('NONE');

/**
 * Frozen object exposing isolation strategies
 * Prevents modification and provides IDE autocomplete
 */
const IsolationStrategy = Object.freeze({
    /**
     * Filter by ownerId only
     * Used for: Products, Variants, Stock (shared across owner's bots)
     *
     * In MULTI mode, queries will filter by ownerId.
     * Multiple bots owned by the same owner will share this data.
     */
    OwnerScoped: OWNER_SCOPED,

    /**
     * Filter by botId only
     * Used for: Admins, Broadcasts, Balance, Vouchers (per-bot isolation)
     *
     * In MULTI mode, queries will filter by botId.
     * Each bot has independent data, even if owned by the same owner.
     */
    BotScoped: BOT_SCOPED,

    /**
     * Filter by both botId and ownerId
     * Used for: Transactions (dual-scoped tracking)
     *
     * In MULTI mode, queries will filter by both botId and ownerId.
     * Provides the most granular data isolation.
     */
    DualScoped: DUAL_SCOPED,

    /**
     * No filtering applied
     * Used for: Global data or SINGLE mode
     *
     * No botId or ownerId filtering will be applied.
     */
    None: NONE,

    /**
     * Get human-readable name for a strategy
     * Useful for logging and error messages
     *
     * @param {Symbol} strategy - The strategy symbol
     * @returns {string} Human-readable name
     */
    getName(strategy) {
        switch (strategy) {
            case OWNER_SCOPED:
                return 'OWNER_SCOPED';
            case BOT_SCOPED:
                return 'BOT_SCOPED';
            case DUAL_SCOPED:
                return 'DUAL_SCOPED';
            case NONE:
                return 'NONE';
            default:
                return 'UNKNOWN';
        }
    },

    /**
     * Validate if value is a valid strategy
     *
     * @param {Symbol} strategy - Value to validate
     * @returns {boolean} True if valid strategy
     */
    isValid(strategy) {
        return strategy === OWNER_SCOPED ||
               strategy === BOT_SCOPED ||
               strategy === DUAL_SCOPED ||
               strategy === NONE;
    },

    /**
     * Convert old string literals to new Symbol constants
     * For backward compatibility during migration
     *
     * This allows repositories to accept both old string-based strategies
     * and new Symbol-based strategies during the transition period.
     *
     * @param {string|Symbol} value - Old string or new Symbol
     * @returns {Symbol} Strategy symbol
     * @throws {Error} If value is neither a valid Symbol nor a valid string
     */
    fromString(value) {
        // If already a Symbol, validate and return
        if (this.isValid(value)) {
            return value;
        }

        // Convert string literal to Symbol
        switch (value) {
            case 'OWNER_SCOPED':
                return OWNER_SCOPED;
            case 'BOT_SCOPED':
                return BOT_SCOPED;
            case 'DUAL_SCOPED':
                return DUAL_SCOPED;
            case 'NONE':
                return NONE;
            default:
                throw new Error(
                    `Invalid isolation strategy: ${value}. ` +
                    `Must be one of: 'OWNER_SCOPED', 'BOT_SCOPED', 'DUAL_SCOPED', 'NONE'`
                );
        }
    }
});

module.exports = IsolationStrategy;
