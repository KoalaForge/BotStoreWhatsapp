const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantSnkRepository = require('../../repositories/ProductVariantSnkRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Delete SNK for a product variant
 * Usage: .delvariantsnk <codeVariant>
 */
const delProductVariantSnk = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];

        if (!codeVariant) {
            return ctx.reply(
                '*Hapus SNK Variant*\n\n' +
                'Format:\n' +
                '`.delvariantsnk <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.delvariantsnk CANVA-1Bulan`'
            );
        }

        const cekProduk = await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
        if (!cekProduk) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        console.log("Deleting variant's SNK");

        await productVariantSnkRepository.deleteByCodeVariant(ctx, codeVariant);
        await ctx.reply(`*SNK berhasil dihapus*\n\nCode variant: \`${codeVariant}\``);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in delProductVariantSnk.js: ${err.message}`));
    }
};

module.exports = delProductVariantSnk;
