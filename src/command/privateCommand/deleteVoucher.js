const { requireAdmin } = require('../../middleware/waAuth');
const voucherService = require('../../services/voucherService');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');
const clc = require('cli-color');
const moment = require('moment-timezone');

const deleteVoucher = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                `*Format salah*\n\n` +
                `Format: .delvoucher <CODE>\n\n` +
                `Contoh: .delvoucher SUMMER2024`
            );
        }

        const code = args[0].toUpperCase().trim();

        const voucher = await voucherService.findVoucherByCode(ctx, code);
        if (!voucher) {
            return ctx.reply(`*Voucher tidak ditemukan*\n\nKode voucher: *${code}*`);
        }

        const deleted = await voucherService.deleteVoucher(ctx, code);

        if (deleted) {
            await ctx.reply(
                `*Voucher berhasil dihapus*\n\n` +
                `Kode voucher: *${code}*\n` +
                `Total penggunaan: ${voucher.used_count} kali`
            );

            console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` +
                clc.blueBright(` Voucher ${code} deleted by admin ${ctx.from}`));
        } else {
            await ctx.reply(`*Gagal menghapus voucher*\n\nSilakan coba lagi`);
        }

    } catch (err) {
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in deleteVoucher: ${err.message}`));

        await ctx.reply(`*Gagal menghapus voucher*\n\n${sanitizeErrorMessage(err)}`);
    }
};

module.exports = deleteVoucher;
