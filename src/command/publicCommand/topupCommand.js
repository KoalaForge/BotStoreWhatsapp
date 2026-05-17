const actions = require('../../actions');
const transactionService = require('../../services/transactionService');
const {
    replyInGroupWithMention,
    buildProcessingLine,
    buildReadyLine
} = require('../../utils/groupReply');

const MIN_NOMINAL = 5000;
const MAX_NOMINAL = 10_000_000;

const USAGE = '*Format Top-up*\n\n' +
    '`.topup <nominal>`\n\n' +
    '_Contoh:_ `.topup 50000`\n' +
    `_Min Rp ${MIN_NOMINAL.toLocaleString('id-ID')} · Max Rp ${MAX_NOMINAL.toLocaleString('id-ID')}_`;

function replyError(ctx, text) {
    if (ctx.isGroup) return replyInGroupWithMention(ctx, text);
    return ctx.reply(text);
}

/**
 * `.topup <nominal>` — generates a QRIS for the requested amount.
 *
 * Group flow: emits a two-state ack — `processing` instantly, then `ready`
 * after the QRIS lands in the user's DM. QRIS itself goes to DM.
 * DM flow: existing behavior — QRIS goes straight to the same chat.
 */
async function topupCommand(ctx) {
    const args = ctx.commandArgs || [];

    if (args.length < 1) return replyError(ctx, USAGE);

    const nominal = parseInt(args[0], 10);
    if (!Number.isInteger(nominal) || nominal <= 0) return replyError(ctx, USAGE);
    if (nominal < MIN_NOMINAL) {
        return replyError(ctx, `*Nominal tidak valid.* Minimal Rp ${MIN_NOMINAL.toLocaleString('id-ID')}.`);
    }
    if (nominal > MAX_NOMINAL) {
        return replyError(ctx, `*Nominal terlalu besar.* Maksimal Rp ${MAX_NOMINAL.toLocaleString('id-ID')}.`);
    }

    if (ctx.isGroup) {
        const pending = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pending) {
            return replyInGroupWithMention(
                ctx,
                'Anda masih punya transaksi pending. Selesaikan transaksi sebelumnya di DM.'
            );
        }

        // 1. INSTANT pre-DM ack — visible while QRIS is being generated.
        await replyInGroupWithMention(ctx, buildProcessingLine()).catch(() => {});

        const dmCtx = ctx.cloneToDM();
        dmCtx.callbackData = `topup-${nominal}`;
        await actions.handleTopUpNominal(dmCtx);

        // 2. POST-DM ready ack — DM now has the QRIS, surface the deep link.
        return replyInGroupWithMention(ctx, buildReadyLine(ctx.sock));
    }

    // DM: original flow
    ctx.callbackData = `topup-${nominal}`;
    return actions.handleTopUpNominal(ctx);
}

module.exports = topupCommand;
