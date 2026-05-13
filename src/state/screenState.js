/**
 * Screen State Management
 * Tracks which "screen" each user is on for text-based navigation.
 * In-memory Map with periodic cleanup (same pattern as buyerNotesState).
 *
 * Screens:
 *   PRODUCT_LIST       — browsing products (default)
 *   VARIANT_SELECT     — choosing a variant for a product
 *   ORDER_CONFIRM      — order confirmation with action menu
 *   QUANTITY_INPUT     — entering quantity
 *   PAY_BALANCE_CONFIRM — confirming balance payment
 *   SALDO_TOPUP        — choosing top-up nominal
 */

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

const _screens = new Map();

// Periodic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of _screens.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            _screens.delete(key);
        }
    }
}, EXPIRY_MS).unref();

/**
 * Get current screen state for a user.
 * @param {string} userId
 * @returns {{ screen: string, productCode?: string, variantCode?: string, variantItems?: Array, page?: number } | null}
 */
function getScreen(userId) {
    const state = _screens.get(userId);
    if (!state) return null;
    if (Date.now() - (state.timestamp || 0) > EXPIRY_MS) {
        _screens.delete(userId);
        return null;
    }
    return state;
}

/**
 * Set screen state for a user.
 * @param {string} userId
 * @param {string} screen - Screen name
 * @param {Object} [data={}] - Additional context data (merged with existing)
 */
function setScreen(userId, screen, data = {}) {
    const existing = _screens.get(userId) || {};
    _screens.set(userId, {
        ...existing,
        ...data,
        screen,
        timestamp: Date.now()
    });
}

/**
 * Clear screen state for a user.
 * @param {string} userId
 */
function clear(userId) {
    _screens.delete(userId);
}

/**
 * Get the parent screen for "back" navigation.
 * @param {string} currentScreen
 * @returns {string}
 */
function getParentScreen(currentScreen) {
    const parents = {
        'VARIANT_SELECT': 'PRODUCT_LIST',
        'ORDER_CONFIRM': 'VARIANT_SELECT',
        'QUANTITY_INPUT': 'ORDER_CONFIRM',
        'PAY_BALANCE_CONFIRM': 'ORDER_CONFIRM',
        'SALDO_TOPUP': 'PRODUCT_LIST'
    };
    return parents[currentScreen] || 'PRODUCT_LIST';
}

module.exports = {
    getScreen,
    setScreen,
    clear,
    getParentScreen
};
