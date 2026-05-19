const actions = require('../../actions');
const { prepareOrder, previewStock } = require('../../actions/showPesanan');
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

        // Pre-flight stock check — surface "tidak ditemukan" / "stok habis" in
        // the group itself so the user doesn't get redirected to DM just to read
        // an error. Side-effect free (no reseller state writes).
        const preview = await previewStock(ctx, code);
        if (!preview.found) {
            return replyInGroupWithMention(ctx, 'Produk tidak ditemukan.');
        }
        if (preview.stockCount === 0) {
            return replyInGroupWithMention(ctx, `Stok *${preview.productName}* habis, tidak bisa melanjutkan.`);
        }
        if (qty > preview.stockCount) {
            return replyInGroupWithMention(
                ctx,
                `Stok *${preview.productName}* tidak cukup. Tersedia: ${preview.stockCount} pcs, diminta: ${qty} pcs.`
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
