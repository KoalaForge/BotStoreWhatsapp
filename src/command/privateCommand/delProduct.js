const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Delete a product and its variants
 * Usage: .delproduct <code>
 */
const delProduct = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const productCode = args[0];

        if (!productCode) {
            return ctx.reply(
                '*Hapus Produk*\n\n' +
                'Format:\n' +
                '`.delproduct <code>`\n\n' +
                'Contoh:\n' +
                '`.delproduct CANVA`'
            );
        }

        const cekProduk = await productRepository.findByCode(ctx, productCode);
        if (!cekProduk) {
            return ctx.reply('*Code produk tidak ditemukan.*');
        }

        // Cascade delete: delete all variants for this product
        await productVariantRepository.deleteVariantsByProduct(ctx, productCode);

        // Delete the product
        await productRepository.deleteProduct(ctx, productCode);

        await ctx.reply('*Produk berhasil dihapus.*');
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in delProduct.js: ${err.message}`));
    }
};

module.exports = delProduct;
