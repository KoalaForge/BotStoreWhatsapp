/**
 * DelStock State Management
 * In-memory state for 2-step stock deletion flow in WhatsApp.
 */

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const delStockState = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, state] of delStockState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            delStockState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

function getUserState(userId) {
    const state = delStockState.get(userId);
    if (!state) return null;

    if (Date.now() - state.timestamp > EXPIRY_MS) {
        delStockState.delete(userId);
        return null;
    }

    return state;
}

function isAwaiting(userId) {
    const state = getUserState(userId);
    return !!(state && state.awaiting);
}

function startInput(userId, codeVariant) {
    delStockState.set(userId, {
        codeVariant,
        awaiting: true,
        timestamp: Date.now(),
    });
}

function getAndClear(userId) {
    const state = getUserState(userId);
    delStockState.delete(userId);
    return state;
}

function clear(userId) {
    delStockState.delete(userId);
}

module.exports = {
    getUserState,
    isAwaiting,
    startInput,
    getAndClear,
    clear,
};
