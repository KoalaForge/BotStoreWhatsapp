const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Set product transaction prefix
 * Usage: .setproductprefix <prefix>
 */
const setProductPrefix = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length === 0) {
            return ctx.reply(
                '*Set Prefix Transaksi Produk*\n\n' +
                'Format:\n' +
                '`.setproductprefix <PREFIX>`\n\n' +
                'Contoh:\n' +
                '`.setproductprefix INV`\n' +
                '`.setproductprefix ORDER`\n' +
                '`.setproductprefix PROD`\n\n' +
                '*Keterangan:*\n' +
                'Prefix untuk ID transaksi pembelian produk.\n' +
                'Format ID: PREFIX-YYMMDD-4DIGIT+2LETTER\n' +
                'Contoh: INV-251117-1234AB'
            );
        }

        const prefix = args[0].toUpperCase().trim();

        // Validate prefix (alphanumeric only, max 10 characters)
        if (!/^[A-Z0-9]+$/.test(prefix) || prefix.length > 10) {
            return ctx.reply(
                '*Prefix tidak valid!*\n\n' +
                'Prefix harus:\n' +
                '- Hanya huruf kapital dan angka\n' +
                '- Maksimal 10 karakter\n\n' +
                'Contoh: `INV`, `ORDER`, `PROD123`, `TRX`'
            );
        }

        await settingsService.updateSettings(ctx, {
            productTransactionPrefix: prefix
        });

        await ctx.reply(
            `*Prefix transaksi produk berhasil diubah*\n\n` +
            `Prefix Baru: \`${prefix}\`\n\n` +
            `Format ID Transaksi:\n` +
            `\`${prefix}-YYMMDD-4DIGIT+2LETTER\`\n\n` +
            `Contoh:\n` +
            `\`${prefix}-${moment().format('YYMMDD')}-1234AB\``
        );

        console.log(clc.green.bold("[ SUCCESS ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Product prefix changed to ${prefix} by user ${ctx.from}`)}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in setProductPrefix.js: ${err.message}`)}`);
    }
};

module.exports = setProductPrefix;
