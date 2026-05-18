'use strict';

/**
 * Group metadata cache keyed by Baileys socket instance.
 *
 * Without this, every `sock.groupMetadata(jid)` call (and every Baileys
 * internal lookup driven by `cachedGroupMetadata`) round-trips to the server
 * and parses a payload that scales linearly with participant count. In a
 * 1000-member group this can take 50-200ms and blocks the event loop —
 * enough repetition causes the keepalive interval (30s) to be missed,
 * surfacing as code 408 disconnects.
 *
 * Storage uses a WeakMap keyed by the sock so:
 *  - Cache lives as long as the sock instance does
 *  - On reconnect (new sock) cache is dropped automatically; the new sock
 *    will fetch fresh metadata (server-side state may have changed during
 *    the disconnect window)
 *  - No manual cleanup required
 */

const META_TTL_MS = 5 * 60_000;

/** @type {WeakMap<object, Map<string, { meta: object, ts: number }>>} */
const _caches = new WeakMap();

function _getCacheFor(sock) {
    let c = _caches.get(sock);
    if (!c) {
        c = new Map();
        _caches.set(sock, c);
    }
    return c;
}

/**
 * Get cached metadata if fresh, otherwise fetch + cache.
 * @param {object} sock - Baileys WASocket
 * @param {string} jid - Group JID (xxx@g.us)
 * @returns {Promise<object>} metadata
 */
async function groupMetadataCached(sock, jid) {
    const cache = _getCacheFor(sock);
    const entry = cache.get(jid);
    if (entry && (Date.now() - entry.ts) < META_TTL_MS) return entry.meta;
    const meta = await sock.groupMetadata(jid);
    cache.set(jid, { meta, ts: Date.now() });
    return meta;
}

/**
 * Lookup-only — returns cached metadata or undefined.
 * Use this for Baileys' `cachedGroupMetadata` option: returning undefined
 * tells Baileys to fetch from server itself.
 */
function getCachedGroupMetadata(sock, jid) {
    const cache = _getCacheFor(sock);
    const entry = cache.get(jid);
    if (entry && (Date.now() - entry.ts) < META_TTL_MS) return entry.meta;
    return undefined;
}

/**
 * Store metadata in cache. Used to seed the cache from events Baileys emits
 * (groups.upsert, groups.update) so subsequent lookups hit the cache.
 */
function setCachedGroupMetadata(sock, jid, meta) {
    if (!jid || !meta) return;
    const cache = _getCacheFor(sock);
    cache.set(jid, { meta, ts: Date.now() });
}

/**
 * Drop a single group's cached metadata. Call from event listeners when the
 * group changes (participants update, settings change, subject change).
 */
function invalidateGroupMetadata(sock, jid) {
    if (!jid) return;
    const cache = _caches.get(sock);
    if (cache) cache.delete(jid);
    // Chain to the derived admin index — when metadata is stale, the index
    // built from it is stale too. Lazy require to avoid circular dep.
    try {
        const { invalidateGroupIndex } = require('./groupAdminIndex');
        invalidateGroupIndex(sock, jid);
    } catch (_) { /* admin index module optional */ }
}

/**
 * Drop all cached metadata for a sock. Used on logout / large state resync.
 */
function invalidateAllForSock(sock) {
    const cache = _caches.get(sock);
    if (cache) cache.clear();
    try {
        const { invalidateAllForSock: dropIdx } = require('./groupAdminIndex');
        dropIdx(sock);
    } catch (_) { /* admin index module optional */ }
}

module.exports = {
    groupMetadataCached,
    getCachedGroupMetadata,
    setCachedGroupMetadata,
    invalidateGroupMetadata,
    invalidateAllForSock,
    META_TTL_MS,
};
