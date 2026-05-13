const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Activate a product
 * Usage: .activateproduct <code>
 */
const activateProduct = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const productCode = args[0];

        if (!productCode) {
            return ctx.reply('Harap masukkan input dengan benar.\n\nFormat: `.activateproduct <code>`');
        }

        const checkCode = await productRepository.findByCode(ctx, productCode);
        if (!checkCode) {
            return ctx.reply('*Code produk tidak ditemukan.*');
        }

        await productRepository.activateProduct(ctx, productCode);

        await ctx.reply('*Produk berhasil diaktifkan.*');
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in activateProduct.js: ${err.message}`));
    }
};

module.exports = activateProduct;
