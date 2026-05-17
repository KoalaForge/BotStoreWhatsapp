const actions = require('../../actions');
const { replyInGroupWithMention, buildReadyLine } = require('../../utils/groupReply');

/**
 * Handle a quoted reply to a `.list` catalog message in a group.
 *
 * The user replied to the bot's catalog message with a number (1-based product
 * index). We resolve that index against the cached productMap, then send the
 * variant detail to the user's DM via a cloned context. The group only gets a
 * short redirect line so the channel stays clean.
 *
 * @param {import('../../whatsapp/WaCtx')} ctx - Original group context
 * @param {number} num - 1-based product index from user's reply text
 * @param {{ productMap: Array<{code: string, name: string}> }} cached - Entry from groupListCache
 */
async function handleListReplyToDM(ctx, num, cached) {
    const map = cached?.productMap || [];
    if (!map.length) {
        return replyInGroupWithMention(ctx, 'Catalog sudah kedaluwarsa. Ketik `.list` lagi.');
    }

    const idx = num - 1;
    if (idx < 0 || idx >= map.length) {
        return replyInGroupWithMention(ctx, `Pilih nomor 1-${map.length}.`);
    }

    const product = map[idx];
    const dmCtx = ctx.cloneToDM();
    dmCtx.callbackData = `prod:${product.code}`;

    await actions.handleProductList(dmCtx);

    await replyInGroupWithMention(
        ctx,
        buildReadyLine(ctx.sock, `Detail *${product.name}* dikirim ke DM.`)
    );
}

module.exports = handleListReplyToDM;
