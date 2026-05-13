const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Set topup transaction prefix
 * Usage: .settopupprefix TOPUP
 */
const setTopupPrefix = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length === 0) {
            return ctx.reply(
                `*Format salah!*\n\n` +
                `*Penggunaan:*\n` +
                `.settopupprefix [PREFIX]\n\n` +
                `*Contoh:*\n` +
                `.settopupprefix TOPUP\n` +
                `.settopupprefix TU\n` +
                `.settopupprefix SALDO\n\n` +
                `*Keterangan:*\n` +
                `Prefix akan digunakan untuk ID transaksi top-up saldo.\n` +
                `Format ID: PREFIX-YYMMDD-4DIGIT+2LETTER\n` +
                `Contoh: TOPUP-251117-1234XY`
            );
        }

        const prefix = args[0].toUpperCase().trim();

        if (!/^[A-Z0-9]+$/.test(prefix) || prefix.length > 10) {
            return ctx.reply(
                `*Prefix tidak valid!*\n\n` +
                `Prefix harus:\n` +
                `- Hanya mengandung huruf kapital dan angka\n` +
                `- Maksimal 10 karakter\n\n` +
                `*Contoh prefix yang valid:*\n` +
                `TOPUP, TU, SALDO, DEPOSIT`
            );
        }

        await settingsService.updateSettings(ctx, {
            topupTransactionPrefix: prefix
        });

        await ctx.reply(
            `*Prefix transaksi top-up berhasil diubah*\n\n` +
            `*Prefix Baru:* ${prefix}\n\n` +
            `*Format ID Transaksi:*\n` +
            `${prefix}-YYMMDD-4DIGIT+2LETTER\n\n` +
            `*Contoh:*\n` +
            `${prefix}-${moment().format('YYMMDD')}-1234XY`
        );

        console.log(clc.green.bold("[ SUCCESS ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Topup prefix changed to ${prefix} by user ${ctx.from}`)}`);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in setTopupPrefix: ${err.message}`)}`);
    }
};

module.exports = setTopupPrefix;
