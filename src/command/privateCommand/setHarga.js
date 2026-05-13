const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Set variant price
 * Usage: .setharga <codeVariant> <price>
 *
 * Note: Telegram version uses `.setharga <price> <codeVariant>` (price first).
 * WhatsApp version uses a more intuitive order: code first, then price.
 */
const setHarga = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                '*Set Harga Variant*\n\n' +
                'Format:\n' +
                '`.setharga <codeVariant> <harga>`\n\n' +
                'Contoh:\n' +
                '`.setharga CANVA-1Bulan 50000`'
            );
        }

        const codeVariant = args[0];
        const price = parseInt(args[1]);

        if (isNaN(price)) {
            return ctx.reply('*Harap masukkan harga dengan benar dan hanya angka!*');
        }

        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        await productVariantRepository.updatePrice(ctx, codeVariant, price);

        await ctx.reply(`*Harga berhasil diupdate.*\n\nVariant: \`${codeVariant}\`\nHarga baru: Rp ${price.toLocaleString('id-ID')}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in setHarga.js: ${err.message}`));
    }
};

module.exports = setHarga;
