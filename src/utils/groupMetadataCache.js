'use strict';

/**
 * Group metadata cache keyed by botId.
 *
 * Previously keyed by sock instance (WeakMap<sock, …>). That dropped the cache
 * on every reconnect (sock recreated → old entry GC'd) — so the first send
 * after a 408 fell through to a fresh server fetch while the server-side
 * device slot was still settling, surfacing as "Connection Closed" 428.
 *
 * Keying by botId (`sock._botId`, tagged in WaConnection._connect) lets the
 * cache survive reconnects. Same bot identity → same cache, regardless of how
 * many times the WS underneath was recycled.
 */

const META_TTL_MS = 5 * 60_000;

/** @type {Map<string, Map<string, { meta: object, ts: number }>>} */
const _caches = new Map();

function _botIdFor(sock) {
    return (sock && sock._botId) || 'single';
}

function _getCacheFor(sock) {
    const botId = _botIdFor(sock);
    let c = _caches.get(botId);
    if (!c) {
        c = new Map();
        _caches.set(botId, c);
    }
    return c;
}

async function groupMetadataCached(sock, jid) {
    const cache = _getCacheFor(sock);
    const entry = cache.get(jid);
    if (entry && (Date.now() - entry.ts) < META_TTL_MS) return entry.meta;
    const meta = await sock.groupMetadata(jid);
    cache.set(jid, { meta, ts: Date.now() });
    return meta;
}

function getCachedGroupMetadata(sock, jid) {
    const cache = _getCacheFor(sock);
    const entry = cache.get(jid);
    if (entry && (Date.now() - entry.ts) < META_TTL_MS) return entry.meta;
    return undefined;
}

function setCachedGroupMetadata(sock, jid, meta) {
    if (!jid || !meta) return;
    const cache = _getCacheFor(sock);
    cache.set(jid, { meta, ts: Date.now() });
}

function invalidateGroupMetadata(sock, jid) {
    if (!jid) return;
    const cache = _caches.get(_botIdFor(sock));
    if (cache) cache.delete(jid);
    try {
        const { invalidateGroupIndex } = require('./groupAdminIndex');
        invalidateGroupIndex(sock, jid);
    } catch (_) { /* admin index module optional */ }
}

function invalidateAllForSock(sock) {
    const cache = _caches.get(_botIdFor(sock));
    if (cache) cache.clear();
    try {
        const { invalidateAllForSock: dropIdx } = require('./groupAdminIndex');
        dropIdx(sock);
    } catch (_) { /* admin index module optional */ }
}

function dropCacheForBot(botId) {
    if (!botId) return;
    _caches.delete(botId);
    try {
        const { dropCacheForBot: dropIdx } = require('./groupAdminIndex');
        dropIdx(botId);
    } catch (_) { /* admin index module optional */ }
}

module.exports = {
    groupMetadataCached,
    getCachedGroupMetadata,
    setCachedGroupMetadata,
    invalidateGroupMetadata,
    invalidateAllForSock,
    dropCacheForBot,
    META_TTL_MS,
};
