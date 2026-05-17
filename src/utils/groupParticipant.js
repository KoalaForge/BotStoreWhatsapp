'use strict';

/**
 * Cross-format WhatsApp group participant identity matching.
 *
 * Groups can address members in two forms:
 *   - @s.whatsapp.net (phone-based, traditional)
 *   - @lid           (anonymous LID, newer addressingMode='lid' groups)
 *
 * sock.user / auth creds expose both. participants[].id is whichever the
 * group uses; participants[].lid and participants[].jid expose the
 * counterpart when known. We match by checking the intersection of all
 * known identity strings, falling back to phone-digit comparison for
 * `@s.whatsapp.net` forms.
 */

function stripDevice(jid) {
    if (!jid) return '';
    return String(jid).split(':')[0];
}

function phoneOf(jid) {
    if (!jid) return '';
    const s = String(jid);
    if (!s.includes('@s.whatsapp.net')) return '';
    return s.split('@')[0].split(':')[0];
}

/**
 * Build a candidate identity set from any number of raw JID strings.
 * Each value is device-stripped. Empty values are skipped.
 */
function identitySet(...vals) {
    const out = new Set();
    for (const v of vals) {
        const s = stripDevice(v);
        if (s) out.add(s);
    }
    return out;
}

/**
 * Collect all identity strings + phone digits from a Baileys participant.
 */
function participantIdentities(p) {
    if (!p) return { ids: new Set(), phones: new Set() };
    const ids = identitySet(p.id, p.lid, p.jid);
    const phones = new Set();
    for (const v of [p.id, p.lid, p.jid]) {
        const ph = phoneOf(v);
        if (ph) phones.add(ph);
    }
    return { ids, phones };
}

/**
 * Build bot identity bundle from a live Baileys sock.
 * Pulls sock.user.{id,lid,jid} AND sock.authState.creds.me.{id,lid,jid}.
 */
function botIdentities(sock) {
    const u = sock?.user || {};
    const me = sock?.authState?.creds?.me || {};
    const ids = identitySet(u.id, u.lid, u.jid, me.id, me.lid, me.jid);
    const phones = new Set();
    for (const v of [u.id, u.lid, u.jid, me.id, me.lid, me.jid]) {
        const ph = phoneOf(v);
        if (ph) phones.add(ph);
    }
    return { ids, phones };
}

/**
 * Build sender identity bundle from a WaCtx.
 * Pulls ctx.jid + key.participant + key.participantAlt + ctx.from.
 */
function senderIdentities(ctx) {
    const key = ctx?.rawMessage?.key || {};
    const ids = identitySet(ctx?.jid, key.participant, key.participantAlt, ctx?.from);
    const phones = new Set();
    for (const v of [ctx?.jid, key.participant, key.participantAlt, ctx?.from]) {
        const ph = phoneOf(v);
        if (ph) phones.add(ph);
    }
    return { ids, phones };
}

function isParticipantAdmin(p) {
    if (!p) return false;
    if (p.admin === 'admin' || p.admin === 'superadmin') return true;
    if (p.isAdmin === true || p.isSuperAdmin === true) return true;
    return false;
}

/**
 * Find the participant entry matching a given identity bundle.
 * Tries direct id-set intersection first, then phone-digit fallback.
 */
function findParticipant(meta, bundle) {
    if (!meta?.participants?.length) return null;
    if (!bundle || (bundle.ids.size === 0 && bundle.phones.size === 0)) return null;

    for (const p of meta.participants) {
        const pBundle = participantIdentities(p);
        for (const id of pBundle.ids) {
            if (bundle.ids.has(id)) return p;
        }
        for (const ph of pBundle.phones) {
            if (bundle.phones.has(ph)) return p;
        }
    }
    return null;
}

/**
 * Summarize participants for diagnostic logs without dumping the whole array.
 * Returns a short string suitable for one log line.
 */
function summarizeMeta(meta, maxEntries = 8) {
    if (!meta?.participants) return 'no metadata';
    const total = meta.participants.length;
    const admins = meta.participants.filter(isParticipantAdmin).slice(0, maxEntries).map(p => {
        const adminTag = p.admin || (p.isSuperAdmin ? 'superadmin' : 'admin');
        return `${p.id}${p.lid ? `|lid=${p.lid}` : ''}${p.jid ? `|jid=${p.jid}` : ''}(${adminTag})`;
    });
    return `mode=${meta.addressingMode || 'unknown'} total=${total} admins=[${admins.join(', ')}]`;
}

/**
 * Preferred mention JID for a participant.
 * Phone form (@s.whatsapp.net) is preferred so receivers' WhatsApp clients
 * can resolve the chip against their contact book / pushName cache.
 * Falls back to id (may be @lid) then lid.
 */
function pickMentionJid(p) {
    if (!p) return '';
    return p.jid || p.id || p.lid || '';
}

/**
 * Digits to use in the body `@<digits>` token. MUST come from the same JID
 * we put in the mentions[] array, otherwise WhatsApp will not bind the chip
 * and the token renders as raw text.
 */
function mentionPhone(p) {
    const j = pickMentionJid(p);
    return j.split('@')[0].split(':')[0];
}

module.exports = {
    stripDevice,
    phoneOf,
    identitySet,
    participantIdentities,
    botIdentities,
    senderIdentities,
    isParticipantAdmin,
    findParticipant,
    summarizeMeta,
    pickMentionJid,
    mentionPhone,
};
