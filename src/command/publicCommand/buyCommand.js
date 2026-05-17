const actions = require('../../actions');
const { prepareOrder } = require('../../actions/showPesanan');
const transactionService = require('../../services/transactionService');
const {
    replyInGroupWithMention,
    buildProcessingLine,
    buildReadyLine
} = require('../../utils/groupReply');

const USAGE = '*Format Pembelian (QRIS)*\n\n' +
    '`.buy <kode> <jumlah>`\n\n' +
    '_Contoh:_ `.buy NETFLIX1B 1`\n' +
    '_Lihat kode produk:_ `.list`';

function replyError(ctx, text) {
    if (ctx.isGroup) return replyInGroupWithMention(ctx, text);
    return ctx.reply(text);
}

/**
 * `.buy <kode> [qty]` — order with QRIS payment.
 *
 * Group flow: emits a two-state ack — `processing` instantly so the user
 * knows the command is received, then `ready` once the QRIS lands in DM.
 * Stock is claimed during prepareOrder (race-safe).
 * DM flow: original quick-buy behavior.
 */
async function buyCommand(ctx) {
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

        // 1. INSTANT pre-DM ack — order resolution + QRIS gen takes a few seconds.
        await replyInGroupWithMention(ctx, buildProcessingLine()).catch(() => {});

        const dmCtx = ctx.cloneToDM();
        dmCtx.match = [null, code];
        const result = await prepareOrder(dmCtx, qty);
        if (!result) {
            // prepareOrder already replied to dmCtx with the specific reason
            // (not found, out of stock, etc.). Direct the user there.
            return replyInGroupWithMention(
                ctx,
                buildReadyLine(ctx.sock, 'Cek DM untuk detail pesanan.')
            );
        }
        await actions.payWithQris(dmCtx);

        // 2. POST-DM ready ack — QRIS is in DM.
        return replyInGroupWithMention(ctx, buildReadyLine(ctx.sock));
    }

    // DM: existing quick-buy behavior
    ctx.match = [null, code];
    const result = await prepareOrder(ctx, qty);
    if (result) await actions.payWithQris(ctx);
}

module.exports = buyCommand;
