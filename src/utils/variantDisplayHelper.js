const productVariantRepository = require('../repositories/ProductVariantRepository');
const stockRepository = require('../repositories/StockRepository');
const resellerService = require('../services/resellerService');

/**
 * Build variant items list for product display.
 * Handles both reseller and normal products, returning a unified
 * array of { name, price, stock, code } objects.
 *
 * @param {Object} ctx - Telegraf context (must have pricingService and repositoryContext)
 * @param {Object} product - Product document (with .code and optional .reseller_source_code)
 * @param {string|null} ownerId - Owner ID for role-based pricing
 * @returns {Promise<Array<{name: string, price: number, stock: number, code: string}>>}
 */
async function buildVariantItems(ctx, product, ownerId) {
    const variantItems = [];

    if (resellerService.isResellerProduct(product)) {
        const displayList = await resellerService.buildVariantDisplayList(ctx, product, ownerId, ctx.pricingService);
        for (const item of displayList) {
            const tierHint = item.tiers && item.tiers.length > 0 ? item.tiers[0] : null;
            variantItems.push({
                name: item.displayName,
                price: item.sellPrice,
                stock: item.platformStockCount,
                code: item.platformVariantCode,
                tierHint
            });
        }
    } else {
        const variants = await productVariantRepository.findActiveVariantsByProduct(ctx, product.code);
        const codeVariants = variants.map(v => v.codeVariant);
        const [stockMap, prices, tierHints] = await Promise.all([
            stockRepository.countStockBatch(ctx, codeVariants),
            Promise.all(variants.map(v => ctx.pricingService.calculatePrice(v, ownerId))),
            Promise.all(variants.map(async (v) => {
                const displayTiers = ctx.pricingService.getDisplayTiers(v);
                if (displayTiers.length === 0) return null;
                const minTier = displayTiers[0];
                const tierUnitPrice = await ctx.pricingService.calculatePriceForQty(v, ownerId, minTier.min_qty);
                return { minQty: minTier.min_qty, tierUnitPrice };
            }))
        ]);
        for (let i = 0; i < variants.length; i++) {
            const data = variants[i];
            variantItems.push({
                name: data.name,
                price: prices[i],
                stock: stockMap.get(data.codeVariant) || 0,
                code: data.codeVariant,
                tierHint: tierHints[i]
            });
        }
    }

    return variantItems;
}

/**
 * Add a button to an inline keyboard array (max 2 buttons per row).
 *
 * @param {Array<Array<Object>>} inlineKeyboard - The keyboard rows array (mutated in place)
 * @param {string} text - Button display text
 * @param {string} callbackData - Callback data string
 * @returns {Array<Array<Object>>} The same keyboard array (for chaining)
 */
function addButton(inlineKeyboard, text, callbackData) {
    const newButton = { text, callback_data: callbackData };
    if (inlineKeyboard.length === 0 || inlineKeyboard[inlineKeyboard.length - 1].length >= 2) {
        inlineKeyboard.push([newButton]);
    } else {
        inlineKeyboard[inlineKeyboard.length - 1].push(newButton);
    }
    return inlineKeyboard;
}

module.exports = { buildVariantItems, addButton };
