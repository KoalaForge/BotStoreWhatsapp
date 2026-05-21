const groupListCache = require('../state/groupListCache');
const handleListReplyToDM = require('../command/publicCommand/handleListReplyToDM');
const autoSuggestService = require('../services/autoSuggestService');

/**
 * Commands the bot answers when invoked in a group chat.
 * Aliases match the registrations in registerCommands.js — keep in sync.
 */
const GROUP_ALLOWED_COMMANDS = new Set([
    'stok', 'stock',
    'list', 'listproduk', 'listproduct', 'produk',
    'saldo', 'balance',
    'topup',
    'buy',
    'buynow',
    'caraorder', 'cara-order',
    'open', 'opengroup', 'openchat',
    'close', 'closegroup', 'closechat',
    'kick',
    'tagall', 'tag',
    'hidetag', 'htag',
    'compactlist', 'togglecompactlist',
    'autosuggest', 'toggleautosuggest'
]);

/**
 * Pull the stanzaId from a quoted reply, regardless of which message envelope
 * Baileys delivered (extendedTextMessage is most common; imageMessage/etc. are
 * possible if the user replied with a captioned media).
 */
function extractQuotedStanzaId(rawMessage) {
    const msg = rawMessage?.message || {};
    const candidates = [
        msg.extendedTextMessage?.contextInfo,
        msg.imageMessage?.contextInfo,
        msg.documentMessage?.contextInfo,
        msg.videoMessage?.contextInfo
    ];
    for (const ci of candidates) {
        if (ci?.stanzaId) return ci.stanzaId;
    }
    return null;
}

/**
 * Group Filter Middleware.
 *
 * In group chats:
 *   1. If the user is quote-replying to a recent `.list` message with a number,
 *      delegate to the DM-reply handler and short-circuit.
 *   2. If the text is a whitelisted dot-command, pass through to handlers.
 *   3. Otherwise, silently drop (no reply) so the bot doesn't spam group chats.
 *
 * DM messages pass through unchanged.
 */
const waGroupFilterMiddleware = async (ctx, next) => {
    console.log('[ AUTOSUGGEST ] groupFilter entry', {
        isGroup: ctx.isGroup,
        chat: ctx.chat,
        msgType: ctx.messageType,
        rawMessage: !!ctx.message,
        textPreview: String(ctx.message || '').slice(0, 60)
    });
    if (!ctx.isGroup) return next();

    const text = (ctx.message || '').trim();
    console.log('[ AUTOSUGGEST ] groupFilter text', { text: text.slice(0, 60), length: text.length, startsWithDot: text.startsWith('.') });

    // 1. Quote-reply to a cached `.list` message with a numeric pick.
    if (/^\d+$/.test(text)) {
        const stanzaId = extractQuotedStanzaId(ctx.rawMessage);
        if (stanzaId) {
            const cached = groupListCache.get(ctx.from);
            if (cached && cached.stanzaId === stanzaId) {
                await handleListReplyToDM(ctx, parseInt(text, 10), cached);
                return; // short-circuit — handled
            }
        }
    }

    // 2. Plain text — try auto-suggest before silent drop.
    if (!text.startsWith('.')) {
        if (text.length >= 2) {
            autoSuggestService.maybeReply(ctx, text).catch(err => {
                console.log('[ AUTOSUGGEST ] middleware catch', err.message);
            });
        }
        return; // silent ignore for command routing
    }

    // 3. Whitelisted dot-commands continue down the chain.
    const cmdName = text.slice(1).split(/\s+/)[0].toLowerCase();
    if (!GROUP_ALLOWED_COMMANDS.has(cmdName)) return; // silent ignore

    return next();
};

module.exports = waGroupFilterMiddleware;
module.exports.GROUP_ALLOWED_COMMANDS = GROUP_ALLOWED_COMMANDS;
