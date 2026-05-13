const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { formatMoney } = require('../../database/models/money');
const { requireAdmin } = require('../../middleware/waAuth');

const listTierPricing = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Lihat Tier Pricing*\n\n' +
                'Format:\n' +
                '`.listtierpricing <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.listtierpricing CANVA-1Bulan`'
            );
        }

        const codeVariant = args[0];

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply('*Code variant tidak ditemukan.*');
        }

        const tiers = (variant.tier_pricing || [])
            .filter(t => t.min_qty >= 2 && t.price >= 1)
            .sort((a, b) => a.min_qty - b.min_qty);

        let message = `*Tier Pricing untuk* \`${codeVariant}\`\n\n`;
        message += `*Base price:* ${formatMoney(variant.price)}\n`;

        if (tiers.length === 0) {
            message += `\n_Belum ada tier pricing._`;
        } else {
            for (const t of tiers) {
                message += `• Min ${t.min_qty} pcs → ${formatMoney(t.price)}\n`;
            }
            message += `\n_Total: ${tiers.length} tier(s)_`;
        }

        await ctx.reply(message);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in listTierPricing.js: ${err.message}`));
    }
};

module.exports = listTierPricing;
