const actions = require('../../actions');
const { prepareOrder } = require('../../actions/showPesanan');
const transactionService = require('../../services/transactionService');
const {
    replyInGroupWithMention,
    buildProcessingLine,
    buildReadyLine
} = require('../../utils/groupReply');

const USAGE = '*Format Pembelian (Saldo)*\n\n' +
    '`.buynow <kode> <jumlah>`\n\n' +
    '_Contoh:_ `.buynow NETFLIX1B 1`\n' +
    '_Lihat kode produk:_ `.list`';

function replyError(ctx, text) {
    if (ctx.isGroup) return replyInGroupWithMention(ctx, text);
    return ctx.reply(text);
}

/**
 * `.buynow <kode> [qty]` — order paid from user balance (no QRIS).
 *
 * Group flow: emits a two-state ack — `processing` instantly, `ready` after
 * the DM confirm prompt is delivered. Final delivery + group success ack
 * happen later via confirmPayBalance.
 * DM flow: original quick-buy behavior.
 */
async function buyNowCommand(ctx) {
    const args = ctx.commandArgs || [];

    if (args.length < 1) return replyError(ctx, USAGE);

    const code = args[0];
    const qty = args[1] ? parseInt(args[1], 10) : 1;
    if (!Number.isInteger(qty) || qty < 1) {
        return replyError(ctx, 'Jumlah minimal 1.');
    }

    if (ctx.isGroup) {
        const pending = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pending) {
            return replyInGroupWithMention(
                ctx,
                'Anda masih punya transaksi pending. Selesaikan transaksi sebelumnya di DM.'
            );
        }

        // 1. INSTANT pre-DM ack.
        await replyInGroupWithMention(ctx, buildProcessingLine()).catch(() => {});

        const dmCtx = ctx.cloneToDM();
        dmCtx.match = [null, code];
        const result = await prepareOrder(dmCtx, qty);
        if (!result) {
            return replyInGroupWithMention(
                ctx,
                buildReadyLine(ctx.sock, 'Cek DM untuk detail pesanan.')
            );
        }
        await actions.handlePayWithBalance(dmCtx);

        // 2. POST-DM ready ack — confirm prompt waits in DM.
        return replyInGroupWithMention(ctx, buildReadyLine(ctx.sock));
    }

    // DM: existing quick-buy behavior
    ctx.match = [null, code];
    const result = await prepareOrder(ctx, qty);
    if (result) await actions.handlePayWithBalance(ctx);
}

module.exports = buyNowCommand;
