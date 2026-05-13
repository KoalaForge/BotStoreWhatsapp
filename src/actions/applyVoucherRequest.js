/**
 * Apply Voucher Request Handler (WhatsApp)
 *
 * In WhatsApp the user types "voucher KODE" to apply a voucher.
 * This handler parses the code from the text and sets the awaiting state.
 */

const voucherState = require('../state/voucherState');
const orderService = require('../services/orderService');
const moment = require('moment-timezone');

/**
 * Handle when user wants to apply a voucher.
 * Called when user types "voucher" (without code) — prompts for code.
 *
 * @param {Object} ctx - WaCtx context
 * @param {string|null} variantCode - Current variant code from order context
 * @param {number|null} orderAmount - Current order quantity
 */
async function handleApplyVoucherRequest(ctx, variantCode, orderAmount) {
    try {
        const userId = ctx.from;

        console.log(`[Voucher] User ${userId} apply voucher request. Order amount: ${orderAmount}`);

        if (!orderAmount) {
            return ctx.reply('Tidak dapat membaca detail pesanan. Silakan buat pesanan terlebih dahulu.');
        }

        // Store state that user is applying voucher
        await voucherState.updateUserVoucherState(userId, {
            awaitingVoucherCode: true,
            variantCode: variantCode,
            orderAmount: orderAmount
        });

        // Ask user to enter voucher code
        await ctx.reply(
            '*Masukkan Kode Voucher*\n\n' +
            'Ketik kode voucher yang ingin Anda gunakan.\n\n' +
            'Contoh: `SUMMER2024`\n\n' +
            '_Ketik `batal` untuk membatalkan_'
        );

        console.log(`User ${userId} requested voucher application`);

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            action: 'handleApplyVoucherRequest',
            error: err.message,
        });
        ctx.reply('*Terjadi kesalahan, gagal memproses permintaan voucher.*');
    }
}

module.exports = handleApplyVoucherRequest;
