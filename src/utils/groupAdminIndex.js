'use strict';

/**
 * Lightweight derived index over group metadata.
 *
 * Full participants[] arrays in a 1000-member group are big (~100KB JSON
 * inflated to a JS array of objects) and iterating them on every command
 * stalls the event loop (5-15ms per pass). Commands rarely need the full
 * array — they ask the same three questions:
 *
 *   1. Is the sender a group admin?
 *   2. Is the bot a group admin?
 *   3. Who is the group owner?
 *
 * This module builds a small derived index (admin Set, member Set, bot flag,
 * owner) once per metadata refresh, then commands look up in O(1) without
 * iterating the participants array. Indexes invalidate together with the
 * underlying metadata cache (groups.update / group-participants.update
 * already trigger that path).
 *
 * Storage is a WeakMap<sock, Map<groupJid, index>>. Survives reconnects via
 * the same sock instance lifetime as groupMetadataCache.
 */

const {
    groupMetadataCached,
} = require('./groupMetadataCache');
const {
    stripDevice,
    phoneOf,
    isParticipantAdmin,
    botIdentities,
} = require('./groupParticipant');

/** @type {WeakMap<object, Map<string, GroupIndex>>} */
const _indexes = new WeakMap();

/**
 * @typedef {Object} GroupIndex
 * @property {Set<string>} adminIds  - stripped JIDs of admins (id, lid, jid forms)
 * @property {Set<string>} adminPhones - phone digits of admins (from @s.whatsapp.net entries)
 * @property {Set<string>} memberIds - stripped JIDs of all members
 * @property {boolean} botIsAdmin
 * @property {string|null} ownerJid
 * @property {number} participantCount
 * @property {number} ts
 */

function _getStore(sock) {
    let store = _indexes.get(sock);
    if (!store) {
        store = new Map();
        _indexes.set(sock, store);
    }
    return store;
}

function _addIdentities(set, phones, p) {
    for (const v of [p.id, p.lid, p.jid]) {
        const s = stripDevice(v);
        if (s) set.add(s);
        const ph = phoneOf(v);
        if (ph) phones.add(ph);
    }
}

/**
 * Build an index from a Baileys group metadata object.
 * @param {object} meta - Result of sock.groupMetadata(jid)
 * @param {{ ids: Set<string>, phones: Set<string> }} botBundle
 * @returns {GroupIndex}
 */
function buildIndex(meta, botBundle) {
    const adminIds = new Set();
    const adminPhones = new Set();
    const memberIds = new Set();
    let botIsAdmin = false;

    const participants = meta?.participants || [];
    for (const p of participants) {
        // Collect membership identities — used by isMember() lookups.
        _addIdentities(memberIds, new Set(), p);

        const admin = isParticipantAdmin(p);
        if (admin) {
            _addIdentities(adminIds, adminPhones, p);
        }

        // Inline bot-is-admin check so we don't iterate again.
        if (!botIsAdmin && botBundle) {
            for (const v of [p.id, p.lid, p.jid]) {
                const s = stripDevice(v);
                if (s && botBundle.ids.has(s)) {
                    botIsAdmin = admin;
                    break;
                }
                const ph = phoneOf(v);
                if (ph && botBundle.phones.has(ph)) {
                    botIsAdmin = admin;
                    break;
                }
            }
        }
    }

    return {
        adminIds,
        adminPhones,
        memberIds,
        botIsAdmin,
        ownerJid: meta?.owner || null,
        participantCount: participants.length,
        ts: Date.now(),
    };
}

/**
 * Get (or lazily build) the index for a group. Uses `groupMetadataCached`
 * under the hood, so cache hits on metadata translate to cache hits on the
 * index too.
 *
 * @param {object} sock - Baileys WASocket
 * @param {string} jid - Group JID
 * @param {{ ids: Set<string>, phones: Set<string> }} [botBundle] - Optional;
 *   if omitted, derived from sock.user.
 * @returns {Promise<GroupIndex|null>} null when metadata fetch fails
 */
async function getGroupIndex(sock, jid, botBundle) {
    const store = _getStore(sock);
    const cached = store.get(jid);
    if (cached) return cached;

    const meta = await groupMetadataCached(sock, jid).catch(() => null);
    if (!meta) return null;

    const bundle = botBundle || botIdentities(sock);
    const index = buildIndex(meta, bundle);
    store.set(jid, index);
    return index;
}

/**
 * Convenience: synchronous admin check given an already-built index + a
 * sender identity bundle. Returns true if any of the sender's ids/phones
 * match an admin.
 */
function isAdminInIndex(index, bundle) {
    if (!index || !bundle) return false;
    for (const id of bundle.ids) {
        if (index.adminIds.has(id)) return true;
    }
    for (const ph of bundle.phones) {
        if (index.adminPhones.has(ph)) return true;
    }
    return false;
}

function invalidateGroupIndex(sock, jid) {
    if (!jid) return;
    const store = _indexes.get(sock);
    if (store) store.delete(jid);
}

function invalidateAllForSock(sock) {
    const store = _indexes.get(sock);
    if (store) store.clear();
}

module.exports = {
    buildIndex,
    getGroupIndex,
    isAdminInIndex,
    invalidateGroupIndex,
    invalidateAllForSock,
};
