const productRepository = require("../repositories/ProductRepository");
const productVariantRepository = require("../repositories/ProductVariantRepository");
const resellerService = require("../services/resellerService");
const stockRepository = require("../repositories/StockRepository");
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const { isAdmin } = require('../utils/checkRole');

async function showAllProductVariant(ctx) {
    try {
        if (!await isAdmin(ctx.from, ctx)) {
            return;
        }

        let text = "*Detail Produk*\n\n";

        const getAllDataProduct = await productRepository.find(ctx, {});
        const getAllDataVariant = await productVariantRepository.find(ctx, {});

        let i = 1;
        for (const product of getAllDataProduct) {
            if (i !== 1) {
                text += "\n";
            }

            const isReseller = resellerService.isResellerProduct(product);
            const resellerTag = isReseller ? '  [RESELLER]' : '';

            text += `${i}. ${product.name}${resellerTag}\n`;
            text += `Code: ${product.code}\n`;
            text += `Status: ${product.isActive ? "Aktif" : "Nonaktif"}\n`;

            if (isReseller) {
                const configs = await resellerService.getVariantConfigs(ctx, product.code);

                let iVariant = 1;
                for (const config of configs) {
                    const platformVariant = await productVariantRepository.findPlatformVariant(config.platform_variant_code);
                    if (!platformVariant || !platformVariant.isActive) continue;

                    const platformStockCount = await stockRepository.countPlatformStock(config.platform_variant_code);
                    const displayName = config.custom_name || platformVariant.name;

                    text += `Variant ${iVariant}: ${displayName} (Reseller)\n`;
                    text += `└ Platform Code: ${config.platform_variant_code}\n`;
                    text += `└ Stok Platform: ${platformStockCount}\n`;

                    iVariant++;
                }

                if (iVariant === 1) {
                    text += `└ Belum ada konfigurasi variant\n`;
                }
            } else {
                let iVariant = 1;
                for (const variant of getAllDataVariant.filter(variant => variant.code === product.code)) {
                    text += `Variant ${iVariant}: ${variant.name}\n`;
                    text += `└ Code: ${variant.codeVariant}\n`;
                    text += `└ Status: ${variant.isActive ? "Aktif" : "Nonaktif"}\n`;

                    iVariant++;
                }
            }

            i++;
        }

        // WhatsApp message limit is ~65536 chars, split at 4000 to be safe
        const chunk = (str, size) =>
            Array.from({ length: Math.ceil(str.length / size) }, (v, i) =>
                str.slice(i * size, i * size + size)
            );

        for (const part of chunk(text, 4000)) {
            await ctx.reply(part);
        }

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = showAllProductVariant;
