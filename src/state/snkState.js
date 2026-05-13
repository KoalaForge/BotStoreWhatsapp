/**
 * SnK State Management
 * In-memory state for multi-step SnK input
 *
 * State Structure: {
 *   userId: {
 *     codeVariant,
 *     termsAndConditions,
 *     timestamp,
 *     awaitingTerms,     // true = waiting for T&C input
 *     awaitingWarranty   // true = waiting for warranty input
 *   }
 * }
 */

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const snkInputState = new Map();

// Periodic cleanup — prevents unbounded Map growth under long uptime
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of snkInputState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            snkInputState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

/**
 * Get SnK state for a user
 * @param {number} userId - Telegram user ID
 * @returns {Object|null} - User's SnK state or null
 */
function getUserSnkState(userId) {
    const state = snkInputState.get(userId);
    if (!state) return null;

    const isExpired = Date.now() - state.timestamp > EXPIRY_MS;
    if (isExpired) {
        snkInputState.delete(userId);
        return null;
    }

    return state;
}

/**
 * Set SnK state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} data - State data
 */
function setUserSnkState(userId, data) {
    snkInputState.set(userId, {
        ...data,
        timestamp: Date.now()
    });
}

/**
 * Clear SnK state for a user
 * @param {number} userId - Telegram user ID
 */
function clearUserSnkState(userId) {
    snkInputState.delete(userId);
}

/**
 * Check if user is waiting for Terms input
 * @param {number} userId - Telegram user ID
 * @returns {boolean}
 */
function isAwaitingTerms(userId) {
    const state = getUserSnkState(userId);
    return state?.awaitingTerms || false;
}

/**
 * Check if user is waiting for Warranty input
 * @param {number} userId - Telegram user ID
 * @returns {boolean}
 */
function isAwaitingWarranty(userId) {
    const state = getUserSnkState(userId);
    return state?.awaitingWarranty || false;
}

/**
 * Start Terms input flow
 * @param {number} userId - Telegram user ID
 * @param {string} codeVariant - Variant code
 */
function startTermsInput(userId, codeVariant) {
    setUserSnkState(userId, {
        codeVariant,
        termsAndConditions: '',
        awaitingTerms: true,
        awaitingWarranty: false
    });
}

/**
 * Save Terms and start Warranty input
 * @param {number} userId - Telegram user ID
 * @param {string} terms - Terms text
 */
function saveTermsAndStartWarranty(userId, terms) {
    const state = getUserSnkState(userId);
    if (!state) return;

    setUserSnkState(userId, {
        ...state,
        termsAndConditions: terms,
        awaitingTerms: false,
        awaitingWarranty: true
    });
}

/**
 * Get complete state and clear
 * @param {number} userId - Telegram user ID
 * @returns {Object|null} - Complete state or null
 */
function getAndClearState(userId) {
    const state = getUserSnkState(userId);
    if (state) {
        clearUserSnkState(userId);
    }
    return state;
}

module.exports = {
    getUserSnkState,
    setUserSnkState,
    clearUserSnkState,
    isAwaitingTerms,
    isAwaitingWarranty,
    startTermsInput,
    saveTermsAndStartWarranty,
    getAndClearState
};
