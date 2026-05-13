/**
 * Remove Voucher Handler (WhatsApp)
 *
 * Triggered when user types "hapusvoucher".
 */

const voucherState = require('../state/voucherState');
const moment = require('moment-timezone');

/**
 * Handle remove voucher action
 * @param {Object} ctx - WaCtx context
 */
async function handleRemoveVoucher(ctx) {
    try {
        const userId = ctx.from;
        const state = await voucherState.getUserVoucherState(userId);

        if (state && state.voucherCode) {
            const removedCode = state.voucherCode;
            const variantCode = state.variantCode;
            await voucherState.clearUserVoucherState(userId);

            await ctx.reply(`Voucher *${removedCode}* dihapus.`);

            console.log(`Voucher ${removedCode} removed for user ${userId}`);

            if (variantCode) {
                ctx.match = [null, variantCode];
                const showPesanan = require('./showPesanan');
                await showPesanan(ctx);
            }
        } else {
            await ctx.reply('Tidak ada voucher yang aktif.');
        }

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            action: 'handleRemoveVoucher',
            error: err.message,
        });
    }
}

module.exports = handleRemoveVoucher;
