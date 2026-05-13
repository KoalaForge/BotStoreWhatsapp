const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

const clearTierPricing = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Hapus Semua Tier Pricing*\n\n' +
                'Format:\n' +
                '`.cleartierpricing <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.cleartierpricing CANVA-1Bulan`'
            );
        }

        const codeVariant = args[0];

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        await productVariantRepository.clearTierPricing(ctx, codeVariant);

        await ctx.reply(
            `*Semua tier pricing berhasil dihapus.*\n\n` +
            `Variant: \`${codeVariant}\``
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in clearTierPricing.js: ${err.message}`));
    }
};

module.exports = clearTierPricing;
