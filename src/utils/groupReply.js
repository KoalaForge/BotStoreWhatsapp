const { getBotPhone } = require('./jidHelper');
const { sendGuarded } = require('./sendGuarded');

// Group acks aren't latency-critical (a 2s-late ack is fine, a dropped one
// looks broken) — give them one extra attempt over the DM default so they ride
// out a longer storm window. 2 → 3 total attempts.
const GROUP_ACK_RETRIES = 2;

/**
 * Send a reply into a group with the sender mentioned and the original
 * message quoted. Bypasses humanize/typing — group replies are intentionally
 * short and immediate so the user can follow the DM redirect quickly.
 *
 * @param {import('../whatsapp/WaCtx')} ctx - Original (group) context, NOT a DM-cloned ctx
 * @param {string} text - Message body (the `@{phone}` prefix is added automatically)
 * @returns {Promise<Object>} Baileys sendMessage result
 */
async function replyInGroupWithMention(ctx, text) {
    // Use key.participant — canonical sender JID in the group's addressing
    // mode. In LID-mode groups this is `xxx@lid`, in phone-mode it's the
    // `@s.whatsapp.net` form. Both the mentions[] entry and the `@<phone>`
    // body token MUST come from this same JID, otherwise WhatsApp won't
    // bind the chip and the token renders as raw text.
    const key = ctx.rawMessage?.key || {};
    const senderJid = key.participant || ctx.jid;
    const phone = String(senderJid).split('@')[0].split(':')[0];
    // Routed through sendGuarded (NOT raw sock.sendMessage) so the group ack
    // gets the same storm-gate + retry that DM sends get. In big groups the ack
    // is a USync-fanout send — the one most likely to draw a 428 mid-storm and,
    // before this, the one with zero retry. That asymmetry was the root cause of
    // "command ran, buyer got DM, group got nothing".
    return sendGuarded(
        ctx.sock,
        ctx.chat,
        {
            text: `@${phone} ${text}`,
            mentions: [senderJid]
        },
        { quoted: ctx.rawMessage },
        { maxRetries: GROUP_ACK_RETRIES, debugKey: key }
    );
}

/**
 * Pre-DM (instant) state line. Fired immediately when a group command is
 * accepted, before the DM-side action runs. Intentionally has no `wa.me`
 * link — DM is not ready yet, linking would mislead the user.
 */
function buildProcessingLine() {
    return '⏳ *Transaksi sedang diproses...*';
}

/**
 * Post-DM (ready) state line. Fired after the DM-side action (QRIS,
 * confirmation prompt, error) has been delivered. Includes the `wa.me/<phone>`
 * shortcut so the user can tap straight into the DM.
 */
function buildReadyLine(sock, label = '✅ *Transaksi siap.* Lanjutkan di DM.') {
    const phone = getBotPhone(sock);
    if (!phone) return label;
    return `${label}\nwa.me/${phone}`;
}

/**
 * Post a thank-you / ack message into the origin group after a transaction
 * completes. Designed to be called from delivery handlers that no longer have
 * the original ctx — only sock + persisted transaction fields are needed.
 *
 * Quotes the user's trigger message when `messageId` + `senderJid` are present
 * so the ack threads under the original command in group view.
 *
 * @param {Object} sock - Baileys WASocket
 * @param {Object} opts
 * @param {string} opts.groupJid - Target group JID (`...@g.us`)
 * @param {string} [opts.senderJid] - Full sender JID for mention (and quoted.participant)
 * @param {string} [opts.senderPhone] - Phone-only string for inline `@<phone>` tag
 * @param {string} [opts.messageId] - Trigger message stanza id for quoted reply
 * @param {string} opts.text - Message body (the `@<phone>` prefix is added automatically when senderPhone is set)
 * @returns {Promise<Object|null>}
 */
async function sendGroupAck(sock, { groupJid, senderJid, senderPhone, messageId, text }) {
    if (!groupJid || !text) return null;
    const opts = {};
    if (messageId && senderJid) {
        opts.quoted = {
            key: {
                remoteJid: groupJid,
                fromMe: false,
                id: messageId,
                participant: senderJid
            },
            message: { conversation: '' }
        };
    }
    // Mention token MUST come from senderJid prefix — `@<phone>` won't bind in
    // LID-mode groups where senderJid is `xxx@lid` (xxx != real phone).
    const tokenFromJid = senderJid ? String(senderJid).split('@')[0].split(':')[0] : null;
    const token = tokenFromJid || senderPhone || null;
    const body = token ? `@${token} ${text}` : text;
    // Routed through sendGuarded so the post-delivery thank-you ack survives the
    // same storm window the QRIS/product DM just rode out. This helper only has
    // `sock` (no ctx) — which is exactly why it bypassed the guard before.
    return sendGuarded(
        sock,
        groupJid,
        {
            text: body,
            mentions: senderJid ? [senderJid] : []
        },
        opts,
        { maxRetries: GROUP_ACK_RETRIES, debugKey: opts.quoted?.key || null }
    );
}

module.exports = {
    replyInGroupWithMention,
    buildProcessingLine,
    buildReadyLine,
    sendGroupAck
};
