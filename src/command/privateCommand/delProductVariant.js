const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Delete a product variant
 * Usage: .delvariant <codeVariant>
 */
const delProductVariant = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];

        if (!codeVariant) {
            return ctx.reply(
                '*Hapus Variant Produk*\n\n' +
                'Format:\n' +
                '`.delvariant <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.delvariant CANVA-1Bulan`'
            );
        }

        const cekProduk = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!cekProduk) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        await productVariantRepository.deleteVariant(ctx, codeVariant);

        await ctx.reply(`*Variant produk berhasil dihapus*\n\nCode: \`${codeVariant}\``);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in delProductVariant.js: ${err.message}`));
    }
};

module.exports = delProductVariant;
