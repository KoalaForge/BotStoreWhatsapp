/**
 * ProfitStock State Management
 * In-memory state for 2-step set-profit-stock flow in WhatsApp.
 */

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const profitStockState = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, state] of profitStockState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            profitStockState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

function getUserState(userId) {
    const state = profitStockState.get(userId);
    if (!state) return null;

    if (Date.now() - state.timestamp > EXPIRY_MS) {
        profitStockState.delete(userId);
        return null;
    }

    return state;
}

function isAwaiting(userId) {
    const state = getUserState(userId);
    return !!(state && state.awaiting);
}

function startInput(userId, codeVariant, profit) {
    profitStockState.set(userId, {
        codeVariant,
        profit: profit || 0,
        awaiting: true,
        timestamp: Date.now(),
    });
}

function getAndClear(userId) {
    const state = getUserState(userId);
    profitStockState.delete(userId);
    return state;
}

function clear(userId) {
    profitStockState.delete(userId);
}

module.exports = {
    getUserState,
    isAwaiting,
    startInput,
    getAndClear,
    clear,
};
