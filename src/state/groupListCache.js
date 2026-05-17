/**
 * Group List Cache
 *
 * When a user runs `.list` in a group, the bot stores the sent message's
 * stanzaId together with the displayed product ordering. Later, when the
 * user quote-replies to that catalog message with a number, the group filter
 * middleware checks this cache to route the reply through to the DM flow.
 *
 * Map<userPhone, { stanzaId, groupJid, productMap, ts }>
 *   productMap: Array<{ code, name }> in catalog display order (1-based by index+1).
 *
 * TTL is short (30 min) to keep behavior predictable as catalogs change.
 */

const EXPIRY_MS = 30 * 60 * 1000;

const _cache = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _cache.entries()) {
        if (now - (entry.ts || 0) > EXPIRY_MS) {
            _cache.delete(key);
        }
    }
}, EXPIRY_MS).unref();

function set(userPhone, { stanzaId, groupJid, productMap }) {
    _cache.set(userPhone, {
        stanzaId,
        groupJid,
        productMap,
        ts: Date.now()
    });
}

function get(userPhone) {
    const entry = _cache.get(userPhone);
    if (!entry) return null;
    if (Date.now() - (entry.ts || 0) > EXPIRY_MS) {
        _cache.delete(userPhone);
        return null;
    }
    return entry;
}

function clear(userPhone) {
    _cache.delete(userPhone);
}

module.exports = { set, get, clear };
