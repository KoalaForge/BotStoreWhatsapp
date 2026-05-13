const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Deactivate a product variant
 * Usage: .deactivateproductvariant <codeVariant>
 */
const deactivateProductVariant = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];

        if (!codeVariant) {
            return ctx.reply('Harap masukkan input dengan benar.\n\nFormat: `.deactivateproductvariant <codeVariant>`');
        }

        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant produk tidak ditemukan.*');
        }

        await productVariantRepository.deactivateVariant(ctx, codeVariant);

        await ctx.reply('*Variant produk berhasil dinonaktifkan.*');
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in deactivateProductVariant.js: ${err.message}`));
    }
};

module.exports = deactivateProductVariant;
