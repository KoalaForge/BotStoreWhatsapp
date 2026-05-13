const productRepository = require('../../repositories/ProductRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const resellerVariantConfigRepository = require('../../repositories/ResellerVariantConfigRepository');
const moment = require('moment-timezone');

/**
 * Split a long message into chunks that fit WhatsApp's message limit.
 * Breaks on newline boundaries to keep stock lines intact.
 */
function splitMessage(text, maxLen = 4000) {
    if (text.length <= maxLen) return [text];
    const lines = text.split('\n');
    const chunks = [];
    let current = '';
    for (const line of lines) {
        const candidate = current ? current + '\n' + line : line;
        if (candidate.length > maxLen) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

const stock = async (ctx) => {
    try {
        // Fetch products and variants in parallel
        const [products, productVariants] = await Promise.all([
            productRepository.findActiveProducts(ctx),
            productVariantRepository.findActiveVariants(ctx)
        ]);

        // Build lookup maps
        const productCodeToName = products.reduce((acc, product) => {
            acc[product.code] = product.name;
            return acc;
        }, {});

        const variantCodeToInfo = productVariants.reduce((acc, variant) => {
            acc[variant.codeVariant] = { name: variant.name, productCode: variant.code };
            return acc;
        }, {});

        // Initialise stockReport with 0 for all owner variants
        const stockReport = {};
        productVariants.forEach((variant) => {
            if (!productCodeToName[variant.code]) return;
            const productName = productCodeToName[variant.code] || 'Unknown Product';
            stockReport[`${productName} - ${variant.name}`] = 0;
        });

        // Batch-count owner stock in ONE aggregation
        const ownerVariantCodes = productVariants.map(v => v.codeVariant);
        const stockCountMap = ownerVariantCodes.length > 0
            ? await stockRepository.countStockBatch(ctx, ownerVariantCodes)
            : new Map();

        productVariants.forEach((variant) => {
            const variantInfo = variantCodeToInfo[variant.codeVariant];
            if (!variantInfo) return;
            const productName = productCodeToName[variantInfo.productCode] || 'Unknown Product';
            const fullProductName = `${productName} - ${variantInfo.name}`;
            stockReport[fullProductName] = stockCountMap.get(variant.codeVariant.toLowerCase()) || 0;
        });

        // Reseller products — batch all DB work
        const resellerProducts = products.filter(p => !!p.reseller_source_code);
        if (resellerProducts.length > 0) {
            const resellerConfigsArray = await Promise.all(
                resellerProducts.map(p =>
                    resellerVariantConfigRepository.findActiveByProductCode(ctx, p.code)
                )
            );

            const allPlatformCodes = resellerConfigsArray.flat().map(c => c.platform_variant_code);
            const uniquePlatformCodes = [...new Set(allPlatformCodes)];

            const [platformStockMap, platformVariants] = await Promise.all([
                allPlatformCodes.length > 0
                    ? stockRepository.countPlatformStockBatch(allPlatformCodes)
                    : Promise.resolve(new Map()),
                Promise.all(
                    uniquePlatformCodes.map(code =>
                        productVariantRepository.findPlatformVariant(code)
                    )
                )
            ]);

            const platformVariantMap = Object.fromEntries(
                platformVariants.filter(Boolean).map(v => [v.codeVariant, v])
            );

            resellerProducts.forEach((resellerProduct, idx) => {
                const configs = resellerConfigsArray[idx];
                for (const config of configs) {
                    const platformVariant = platformVariantMap[config.platform_variant_code];
                    if (!platformVariant || !platformVariant.isActive) continue;
                    const platformStockCount =
                        platformStockMap.get(config.platform_variant_code.toLowerCase()) || 0;
                    const displayName = config.custom_name || platformVariant.name;
                    stockReport[`${resellerProduct.name} - ${displayName}`] = platformStockCount;
                }
            });
        }

        // Sort alphabetically then split into available / empty
        const sortedStockEntries = Object.entries(stockReport).sort(
            ([nameA], [nameB]) => nameA.localeCompare(nameB)
        );

        const available = sortedStockEntries.filter(([, count]) => count > 0);
        const empty = sortedStockEntries.filter(([, count]) => count === 0);

        // Format output with WhatsApp markdown
        let reportString = `*Laporan Stok Produk*\n`;
        reportString += `_${moment().locale('id').format('dddd, DD MMM YYYY')}  ·  ${moment().locale('id').format('HH:mm')} WIB_\n`;

        if (available.length > 0) {
            reportString += `\n*Tersedia*\n`;
            for (const [productName, stockCount] of available) {
                reportString += `● ${productName}  ·  *${stockCount}* pcs\n`;
            }
        }

        if (empty.length > 0) {
            reportString += `\n*Habis*\n`;
            for (const [productName] of empty) {
                reportString += `○ ${productName}\n`;
            }
        }

        if (sortedStockEntries.length === 0) {
            reportString += `\n_Belum ada produk aktif._`;
        }

        // Split and send
        const chunks = splitMessage(reportString, 4000);
        for (const chunk of chunks) {
            await ctx.reply(chunk);
        }

    } catch (error) {
        console.error('Error fetching data from MongoDB:', error);
        await ctx.reply('Gagal menghasilkan laporan stok.');
    }
};

module.exports = stock;
