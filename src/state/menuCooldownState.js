/**
 * Menu Cooldown State
 * Throttles fallback/greeting menu sends per user to prevent the bot from
 * re-sending the product list on every unrecognised message in a spam burst.
 * In-memory only — restart resets cooldown (acceptable, short window).
 */

const COOLDOWN_MS = 30 * 1000;

const _lastSent = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of _lastSent.entries()) {
        if (now - ts > COOLDOWN_MS) _lastSent.delete(key);
    }
}, COOLDOWN_MS).unref();

function shouldSendMenu(userId) {
    const key = String(userId);
    const last = _lastSent.get(key);
    if (!last) return true;
    return Date.now() - last > COOLDOWN_MS;
}

function markMenuSent(userId) {
    _lastSent.set(String(userId), Date.now());
}

function clear(userId) {
    _lastSent.delete(String(userId));
}

module.exports = {
    shouldSendMenu,
    markMenuSent,
    clear,
    COOLDOWN_MS
};
