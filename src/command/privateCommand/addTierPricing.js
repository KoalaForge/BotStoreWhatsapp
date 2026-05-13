const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

const addTierPricing = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 3) {
            return ctx.reply(
                '*Tambah Tier Pricing (Harga Grosir)*\n\n' +
                'Format:\n' +
                '`.addtierpricing <codeVariant> <minQty> <harga>`\n\n' +
                'Contoh:\n' +
                '`.addtierpricing CANVA-1Bulan 5 45000`\n\n' +
                '_minQty minimal 2_'
            );
        }

        const codeVariant = args[0];
        const minQty = parseInt(args[1]);
        const price = parseInt(args[2]);

        if (isNaN(minQty) || isNaN(price)) {
            return ctx.reply('*minQty dan harga harus berupa angka.*');
        }
        if (minQty < 2) {
            return ctx.reply('*minQty harus ≥ 2.*');
        }
        if (price < 1) {
            return ctx.reply('*Harga harus ≥ 1.*');
        }

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        await productVariantRepository.addTierPricing(ctx, codeVariant, minQty, price);

        await ctx.reply(
            `*Tier pricing berhasil ditambahkan.*\n\n` +
            `Variant: \`${codeVariant}\`\n` +
            `Min Qty: ${minQty} pcs\n` +
            `Harga: Rp ${price.toLocaleString('id-ID')}`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in addTierPricing.js: ${err.message}`));
    }
};

module.exports = addTierPricing;
