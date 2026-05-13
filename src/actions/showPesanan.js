const productVariantRepository = require("../repositories/ProductVariantRepository");
const stockRepository = require("../repositories/StockRepository");
const productRepository = require("../repositories/ProductRepository");
const resellerService = require("../services/resellerService");
const resellerState = require("../state/resellerState");
const messageFormatter = require("../utils/waMessageFormatter");
const orderService = require("../services/orderService");
const voucherState = require("../state/voucherState");
const buyerNotesState = require("../state/buyerNotesState");
const { buildOrderMenuText } = require("../utils/orderMenuText");
const settingsService = require("../services/settingsService");
const screenState = require('../state/screenState');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');

/**
 * Resolve variant context for both normal and reseller products.
 * Returns all data needed to display an order confirmation.
 *
 * @param {Object} ctx - WaCtx context
 * @param {string} variantValue - Variant code from callback data
 * @returns {Promise<Object|null>} - Resolved context or null if not found
 */
async function resolveVariantContext(ctx, variantValue, quantity = 1) {
    const ownerId = ctx.repositoryContext?.ownerId;

    // Step 1: Try own variant (normal flow)
    const ownVariant = await productVariantRepository.findByCodeVariant(ctx, variantValue);

    if (ownVariant) {
        // NORMAL product — parallel fetch: product info + stock count + price (independent)
        await resellerState.clearResellerOrder(ctx.from);
        const [product, stockCount, effectivePrice] = await Promise.all([
            productRepository.findByCode(ctx, ownVariant.code),
            stockRepository.countStock(ctx, variantValue),
            ctx.pricingService.calculatePriceForQty(ownVariant, ownerId, quantity)
        ]);
        const applicableTier = ctx.pricingService.getApplicableTier(ownVariant, quantity);
        const nextTier = ctx.pricingService.getNextTier(ownVariant, quantity);

        return {
            variant: ownVariant,
            product,
            effectivePrice,
            stockCount,
            displayVariantName: ownVariant.name,
            isReseller: false,
            markupPerUnit: 0,
            applicableTier,
            nextTier
        };
    }

    // RESELLER detection: variant not in owner scope — try platform
    const result = await resellerService.resolveVariantFromCallback(ctx, variantValue);
    if (!result) {
        return null;
    }

    const variant = result.platformVariant;
    const product = result.resellerProduct;
    const resellerConfig = result.config;

    // Parallel fetch: role price + platform stock count (independent of each other)
    const [rolePrice, stockCount] = await Promise.all([
        ctx.pricingService.calculatePriceForQty(variant, ownerId, quantity),
        stockRepository.countPlatformStock(variantValue)
    ]);
    const applicableTier = ctx.pricingService.getApplicableTier(variant, quantity);
    const nextTier = ctx.pricingService.getNextTier(variant, quantity);
    const { price: effectivePrice, isOverride } = resellerService.applyResellerPricing(rolePrice, resellerConfig, applicableTier?.min_qty ?? null);
    const markupPerUnit = effectivePrice - rolePrice;
    const displayVariantName = resellerConfig.custom_name || variant.name;

    // Store reseller state for payment handlers (includes markupPerUnit for voucher cap)
    await resellerState.setResellerOrder(ctx.from, {
        platformVariantCode: variantValue,
        resellerProductCode: product.code,
        configId: resellerConfig._id,
        markup_type: resellerConfig.markup_type,
        markup_value: resellerConfig.markup_value,
        displayName: displayVariantName,
        markupPerUnit
    });

    return {
        variant,
        product,
        effectivePrice,
        stockCount,
        displayVariantName,
        isReseller: true,
        markupPerUnit,
        applicableTier,
        nextTier
    };
}

/**
 * Prepare order context: resolve variant, build order message, set all state.
 * Returns the prepared data or null if failed (sends error reply).
 * Does NOT send the order confirmation message.
 */
async function prepareOrder(ctx, quantity = 1) {
    const variantValue = ctx.match[1];

    const orderQuantity = Math.max(1, parseInt(quantity, 10) || 1);

    const variantContext = await resolveVariantContext(ctx, variantValue, orderQuantity);
    if (!variantContext) {
        await ctx.reply('Produk tidak ditemukan.');
        return null;
    }

    const { variant, product, effectivePrice, stockCount, displayVariantName, isReseller, markupPerUnit, applicableTier, nextTier } = variantContext;

    if (!product) {
        await ctx.reply('Produk tidak ditemukan.');
        return null;
    }

    if (stockCount === 0) {
        await ctx.reply('Stok habis, tidak bisa melanjutkan.');
        return null;
    }

    if (orderQuantity > stockCount) {
        await ctx.reply(`Stok tidak cukup. Tersedia: ${stockCount} pcs, diminta: ${orderQuantity} pcs.`);
        return null;
    }
    const userId = ctx.from;
    const subtotal = orderQuantity * effectivePrice;
    const resellerContext = isReseller ? { markupPerUnit, quantity: orderQuantity } : null;

    const [voucherDetails, settings, buyerNotes] = await Promise.all([
        orderService.getVoucherDetails(userId, subtotal, resellerContext),
        settingsService.getSettings(ctx),
        buyerNotesState.getAppliedNotes(userId)
    ]);
    const { voucherCode, voucherDiscount, isCapped, totalPrice } = voucherDetails;
    const saldoEnabled = settings?.saldoEnabled !== false;

    const tierHint = (applicableTier || nextTier) ? { applicableTier, nextTier } : null;

    const data = messageFormatter.formatOrderConfirmation({
        productName: product.name,
        variantName: displayVariantName,
        price: effectivePrice,
        stockAvailable: stockCount,
        orderQuantity,
        totalPrice,
        voucherCode,
        voucherDiscount,
        subtotal,
        isDiscountCapped: isCapped,
        buyerNotes,
        tierHint
    });

    const { menuText, actionMap } = buildOrderMenuText({
        saldoEnabled,
        voucherCode,
        buyerNotes
    });

    await voucherState.updateUserVoucherState(userId, {
        variantCode: variantValue,
        orderAmount: orderQuantity
    });

    screenState.setScreen(userId, 'ORDER_CONFIRM', {
        variantCode: variantValue,
        productCode: product.code,
        actionMap,
        orderMessage: data
    });

    // Set session for payment handlers
    if (!ctx.session) ctx.session = {};
    ctx.session.lastOrderMessage = data;

    return { data, menuText, variantCode: variantValue, productCode: product.code };
}

async function showPesanan(ctx) {
    try {
        const result = await prepareOrder(ctx);
        if (!result) return;
        return ctx.reply(`${result.data}${result.menuText}`);
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = showPesanan;
module.exports.prepareOrder = prepareOrder;
