const { getBotPhone } = require('./jidHelper');

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
    const userJid = ctx.jid;
    const mentionTag = `@${ctx.from}`;
    return ctx.sock.sendMessage(
        ctx.chat,
        {
            text: `${mentionTag} ${text}`,
            mentions: [userJid]
        },
        { quoted: ctx.rawMessage }
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
    const body = senderPhone ? `@${senderPhone} ${text}` : text;
    return sock.sendMessage(
        groupJid,
        {
            text: body,
            mentions: senderJid ? [senderJid] : []
        },
        opts
    );
}

module.exports = {
    replyInGroupWithMention,
    buildProcessingLine,
    buildReadyLine,
    sendGroupAck
};
