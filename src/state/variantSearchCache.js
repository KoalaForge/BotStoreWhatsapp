const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function get(key) {
    const k = key || '__default__';
    const entry = cache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) {
        cache.delete(k);
        return null;
    }
    return entry.variants;
}

function set(key, variants) {
    const k = key || '__default__';
    cache.set(k, { variants, ts: Date.now() });
}

function invalidate(key) {
    if (!key) {
        cache.clear();
        return;
    }
    cache.delete(key);
}

module.exports = { get, set, invalidate, TTL_MS };
