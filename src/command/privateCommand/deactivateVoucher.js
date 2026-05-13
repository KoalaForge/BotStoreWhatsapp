const { requireAdmin } = require('../../middleware/waAuth');
const voucherService = require('../../services/voucherService');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');
const clc = require('cli-color');
const moment = require('moment-timezone');

const deactivateVoucher = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                `*Format salah*\n\n` +
                `Format: .deactivatevoucher <CODE>\n\n` +
                `Contoh: .deactivatevoucher SUMMER2024`
            );
        }

        const code = args[0].toUpperCase().trim();

        const voucher = await voucherService.findVoucherByCode(ctx, code);
        if (!voucher) {
            return ctx.reply(`*Voucher tidak ditemukan*\n\nKode voucher: *${code}*`);
        }

        if (!voucher.is_active) {
            return ctx.reply(`*Voucher sudah tidak aktif*\n\nKode voucher: *${code}*`);
        }

        const deactivated = await voucherService.deactivateVoucher(ctx, code);

        if (deactivated) {
            await ctx.reply(
                `*Voucher berhasil dinonaktifkan*\n\n` +
                `Kode voucher: *${code}*\n` +
                `Voucher sekarang tidak dapat digunakan oleh customer`
            );

            console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` +
                clc.blueBright(` Voucher ${code} deactivated by admin ${ctx.from}`));
        } else {
            await ctx.reply(`*Gagal menonaktifkan voucher*\n\nSilakan coba lagi`);
        }

    } catch (err) {
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in deactivateVoucher: ${err.message}`));

        await ctx.reply(`*Gagal menonaktifkan voucher*\n\n${sanitizeErrorMessage(err)}`);
    }
};

module.exports = deactivateVoucher;
