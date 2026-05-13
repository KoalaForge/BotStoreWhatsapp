const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const orderTransactionItemRepository = require('../../repositories/OrderTransactionItemRepository');
const botUserRepository = require('../../repositories/BotUserRepository');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const settingsService = require('../../services/settingsService');
const resellerService = require('../../services/resellerService');
const { formatMoney } = require('../../database/models/money');
const screenState = require('../../state/screenState');

const listProduct = async (ctx, pageNumber = 1) => {
    try {
        const jid = ctx.from;
        const displayName = ctx.fromUser?.first_name || jid;

        // Run all DB queries in parallel
        const ownerId = ctx.repositoryContext?.ownerId;
        const [setting, userBalance, allProducts, soldMap] = await Promise.all([
            settingsService.getSettings(ctx),
            botUserBalanceRepository.findByUserId(ctx, jid),
            productRepository.findActiveProducts(ctx, { sort: { name: 1 } }),
            orderTransactionItemRepository.batchSoldCount(ctx)
        ]);

        // Sync user info (fire-and-forget)
        botUserRepository.upsertWhatsappUser(ctx, jid, displayName).catch(() => {});

        // Create balance if not exists
        if (!userBalance) {
            await botUserBalanceRepository.create(ctx, {
                userId: jid,
                balance: 0,
                totalTopUp: 0,
                totalSpent: 0
            }).catch(() => {});
        }

        const balance = userBalance?.balance || 0;

        const productsToShow = allProducts;

        if (productsToShow.length === 0) {
            await ctx.reply('*Belum ada produk tersedia*');
            return;
        }

        // Fetch variants + stock counts for each product (owner-scoped or reseller)
        const variantPromises = productsToShow.map(async (product) => {
            if (resellerService.isResellerProduct(product)) {
                const displayList = await resellerService.buildVariantDisplayList(ctx, product, ownerId, ctx.pricingService);
                return displayList.map(d => ({
                    name: d.displayName,
                    price: d.sellPrice,
                    codeVariant: d.platformVariantCode,
                    stockCount: d.platformStockCount
                }));
            }
            const variants = await productVariantRepository.findActiveVariantsByProduct(ctx, product.code);
            // Batch stock counts for normal variants
            const stockCounts = await Promise.all(
                variants.map(v => stockRepository.countStock(ctx, v.codeVariant))
            );
            return variants.map((v, idx) => ({
                name: v.name,
                price: v.price,
                codeVariant: v.codeVariant,
                stockCount: stockCounts[idx]
            }));
        });
        const variantResults = await Promise.all(variantPromises);

        // --- Build message ---
        const lines = [];

        // Header
        lines.push(`*Saldo:* ${formatMoney(balance)}`);
        lines.push('');

        productsToShow.forEach((product, i) => {
            const variants = variantResults[i] || [];

            lines.push(`*${i + 1}. ${product.name}*`);

            if (variants.length === 0) {
                lines.push('    _Belum ada varian_');
                lines.push('');
                return;
            }

            for (const v of variants) {
                const sold = soldMap.get(v.codeVariant) || 0;
                lines.push(`    ${v.name}`);
                lines.push(`    ${formatMoney(v.price)} · ${v.stockCount} stok · ${sold} terjual`);
                lines.push(`    ➜ \`buy ${v.codeVariant} 1\` — QRIS`);
                lines.push(`    ➜ \`buynow ${v.codeVariant} 1\` — Saldo`);
                // Add spacing between variants of same product
                if (variants.length > 1) lines.push('');
            }
            // Spacing between products (avoid double blank if last variant already added one)
            if (variants.length <= 1) lines.push('');
        });

        // Guide
        lines.push('*Perintah:*');
        lines.push('· `.saldo` — Cek & top-up saldo');
        lines.push('· `.stok` — Lihat stok lengkap');
        lines.push('· `riwayat` — Riwayat transaksi');
        lines.push('· `cara order` — Panduan order lengkap');

        screenState.setScreen(jid, 'PRODUCT_LIST', {});

        await ctx.reply(lines.join('\n'));

    } catch (err) {
        console.log(err);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/listProduct.js  ${err.message}`));
    }
};

module.exports = listProduct;
