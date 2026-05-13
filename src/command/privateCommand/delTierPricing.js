const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

const delTierPricing = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                '*Hapus Tier Pricing*\n\n' +
                'Format:\n' +
                '`.deltierpricing <codeVariant> <minQty>`\n\n' +
                'Contoh:\n' +
                '`.deltierpricing CANVA-1Bulan 5`'
            );
        }

        const codeVariant = args[0];
        const minQty = parseInt(args[1]);

        if (isNaN(minQty)) {
            return ctx.reply('*minQty harus berupa angka.*');
        }

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        await productVariantRepository.removeTierPricing(ctx, codeVariant, minQty);

        await ctx.reply(
            `*Tier pricing berhasil dihapus.*\n\n` +
            `Variant: \`${codeVariant}\`\n` +
            `Min Qty: ${minQty} pcs`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in delTierPricing.js: ${err.message}`));
    }
};

module.exports = delTierPricing;
