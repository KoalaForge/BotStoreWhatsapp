const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Set who pays the payment gateway fee for product purchases.
 * Does not affect balance top-up (always charged to customer).
 * Usage: .setfee customer | .setfee merchant
 */
const setFee = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length === 0) {
            const settings = await settingsService.getSettings(ctx);
            const currentFeePaidBy = settings?.feePaidBy || 'customer';

            return ctx.reply(
                `*Pengaturan Biaya Payment Gateway*\n\n` +
                `*Status Saat Ini:* ${currentFeePaidBy === 'customer' ? 'Customer' : 'Merchant'}\n\n` +
                `*Penggunaan:*\n` +
                `.setfee customer — Customer menanggung biaya\n` +
                `.setfee merchant — Merchant menanggung biaya\n\n` +
                `*Penjelasan:*\n\n` +
                `*Customer menanggung biaya:*\n` +
                `- Harga produk: Rp 10,000\n` +
                `- Fee gateway (1.7%): Rp 170\n` +
                `- *Customer bayar: Rp 10,170*\n\n` +
                `*Merchant menanggung biaya:*\n` +
                `- Harga produk: Rp 10,000\n` +
                `- Fee gateway (1.7%): Rp 170\n` +
                `- *Customer bayar: Rp 10,000*\n` +
                `- Fee tetap tercatat untuk laporan\n` +
                `- Merchant yang menanggung Rp 170`
            );
        }

        const feePaidBy = args[0].toLowerCase().trim();

        if (!['customer', 'merchant'].includes(feePaidBy)) {
            return ctx.reply(
                `*Pilihan tidak valid!*\n\n` +
                `*Pilihan yang tersedia:*\n` +
                `customer — Customer menanggung biaya gateway\n` +
                `merchant — Merchant menanggung biaya gateway\n\n` +
                `*Contoh penggunaan:*\n` +
                `.setfee customer\n` +
                `.setfee merchant`
            );
        }

        await settingsService.updateSettings(ctx, { feePaidBy });

        let successMessage = `*Pengaturan biaya berhasil diubah*\n\n`;

        if (feePaidBy === 'customer') {
            successMessage +=
                `*Pengaturan Baru:* Customer menanggung biaya\n\n` +
                `*Dampak untuk transaksi berikutnya:*\n` +
                `- Customer akan membayar harga produk + biaya gateway\n` +
                `- Contoh: Produk Rp 10,000 → Customer bayar Rp 10,170\n\n` +
                `*Catatan:*\n` +
                `Ini adalah pengaturan default (standar).`;
        } else {
            successMessage +=
                `*Pengaturan Baru:* Merchant menanggung biaya\n\n` +
                `*Dampak untuk transaksi berikutnya:*\n` +
                `- Customer hanya membayar harga produk\n` +
                `- Biaya gateway ditanggung merchant\n` +
                `- Contoh: Produk Rp 10,000 → Customer bayar Rp 10,000\n` +
                `- Merchant menanggung fee (Rp 170 untuk transaksi 10rb)\n\n` +
                `*Catatan:*\n` +
                `Fee tetap tercatat di laporan untuk keperluan akuntansi.\n` +
                `Message pembayaran akan menampilkan 'Biaya ditanggung: Merchant'.`;
        }

        await ctx.reply(successMessage);

        console.log(
            clc.green.bold("[ SUCCESS ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`Fee paid by changed to '${feePaidBy}' by user ${ctx.from}`)
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in command/privateCommand/setFee.js: ${err.message}`)
        );
    }
};

module.exports = setFee;
