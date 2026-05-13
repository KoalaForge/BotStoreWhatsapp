/**
 * Voucher Code Input Handler (WhatsApp)
 *
 * Handles voucher code input from user text messages.
 * In WhatsApp, the user types "voucher KODE" directly or types the code
 * when in awaiting-voucher state.
 */

const voucherService = require('../services/voucherService');
const voucherState = require('../state/voucherState');
const moment = require('moment-timezone');

/**
 * Handle voucher code input from user
 * @param {Object} ctx - WaCtx context
 * @param {string} voucherCode - Voucher code entered by user
 * @returns {Promise<boolean>} - True if handled, false if not waiting for voucher
 */
async function handleVoucherCodeInput(ctx, voucherCode) {
    try {
        const userId = ctx.from;
        const state = await voucherState.getUserVoucherState(userId);

        if (!state || !state.awaitingVoucherCode) {
            return false; // Not waiting for voucher code
        }

        // Get order amount from stored state
        const orderAmount = state.orderAmount;

        if (!orderAmount) {
            await ctx.reply('*Terjadi kesalahan, tidak dapat membaca detail pesanan.*');
            await voucherState.clearUserVoucherState(userId);
            return true;
        }

        // Validate voucher
        const result = await voucherService.validateAndApplyVoucher(ctx, voucherCode, orderAmount);

        if (result.isValid) {
            // Store voucher in user state
            await voucherState.setUserVoucherState(userId, {
                voucherCode: result.voucherCode,
                discountAmount: result.discountAmount,
                discountType: result.discountType,
                discountValue: result.discountValue,
                maxDiscountAmount: result.maxDiscountAmount,
                variantCode: state.variantCode,
                awaitingVoucherCode: false,
                orderAmount: state.orderAmount
            });

            await ctx.reply(
                `*Voucher Berhasil Diterapkan*\n\n` +
                `*Kode:* ${result.voucherCode}\n` +
                `*Diskon:* Rp ${result.discountAmount.toLocaleString('id-ID')}`
            );

            console.log(`Voucher ${result.voucherCode} applied for user ${userId}`);

            // Auto re-render order confirmation with updated price
            if (state.variantCode) {
                ctx.match = [null, state.variantCode];
                const showPesanan = require('./showPesanan');
                await showPesanan(ctx);
            }
        } else {
            await ctx.reply(
                `*Voucher Tidak Valid*\n\n` +
                `${result.errorMessage}\n\n` +
                `_Silakan coba lagi dengan kode voucher yang berbeda._`
            );

            // Clear awaiting state but keep other state
            await voucherState.updateUserVoucherState(userId, {
                awaitingVoucherCode: false
            });
        }

        return true; // Handled

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            action: 'handleVoucherCodeInput',
            error: err.message,
        });
        ctx.reply('*Terjadi kesalahan, gagal memvalidasi voucher.*');
        return true;
    }
}

module.exports = handleVoucherCodeInput;
