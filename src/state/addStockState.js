/**
 * AddStock State Management
 * In-memory state for 2-step stock input flow in WhatsApp.
 *
 * Flow:
 * 1. Admin sends `.addstock CODE-VARIANT [profit]`
 * 2. Bot replies "Kirim data stock (satu per baris):"
 * 3. Admin sends multi-line stock data
 * 4. Bot processes and confirms
 *
 * State Structure: {
 *   userId: {
 *     codeVariant,
 *     profit,
 *     timestamp,
 *     awaitingStockData   // true = waiting for stock lines
 *   }
 * }
 */

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const stockInputState = new Map();

// Periodic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of stockInputState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            stockInputState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

function getUserStockState(userId) {
    const state = stockInputState.get(userId);
    if (!state) return null;

    if (Date.now() - state.timestamp > EXPIRY_MS) {
        stockInputState.delete(userId);
        return null;
    }

    return state;
}

function isAwaitingStockData(userId) {
    const state = getUserStockState(userId);
    return !!(state && state.awaitingStockData);
}

function startStockInput(userId, codeVariant, profit) {
    stockInputState.set(userId, {
        codeVariant,
        profit: profit || 0,
        awaitingStockData: true,
        timestamp: Date.now(),
    });
}

function getAndClearState(userId) {
    const state = getUserStockState(userId);
    stockInputState.delete(userId);
    return state;
}

function clearState(userId) {
    stockInputState.delete(userId);
}

module.exports = {
    getUserStockState,
    isAwaitingStockData,
    startStockInput,
    getAndClearState,
    clearState,
};
