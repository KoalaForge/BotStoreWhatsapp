const productVariantRepository = require("../repositories/ProductVariantRepository");
const productRepository = require("../repositories/ProductRepository");
const stockRepository = require("../repositories/StockRepository");
const resellerVariantConfigRepository = require("../repositories/ResellerVariantConfigRepository");
const messageFormatter = require("../utils/waMessageFormatter");
const orderService = require("../services/orderService");
const resellerState = require("../state/resellerState");
const resellerService = require("../services/resellerService");
const buyerNotesState = require("../state/buyerNotesState");
const { buildOrderMenuText } = require("../utils/orderMenuText");
const settingsService = require("../services/settingsService");
const screenState = require('../state/screenState');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');

/**
 * Handle quantity change for an order in WhatsApp.
 *
 * In Telegram this was +1/-1/+5/-5 buttons. In WhatsApp the user types
 * the desired quantity as a plain number while in order context.
 *
 * @param {Object} ctx - WaCtx
 * @param {string} variantCode - The variant code from order state
 * @param {number} newQuantity - The desired quantity
 */
async function plusMinesStockProduct(ctx, variantCode, newQuantity) {
    try {
        const userId = ctx.from;

        if (!variantCode) {
            return ctx.reply('*Gagal memproses pesanan.* Data tidak lengkap.');
        }

        // Look up the variant
        let variant = await productVariantRepository.findByCodeVariant(ctx, variantCode);

        // Reseller fallback
        const resellerOrder = !variant ? await resellerState.getResellerOrder(userId) : null;
        if (resellerOrder) {
            variant = await productVariantRepository.findPlatformVariant(resellerOrder.platformVariantCode);
        }

        if (!variant) {
            return ctx.reply('*Variant tidak ditemukan.*');
        }

        const ownerId = ctx.repositoryContext?.ownerId;
        const isReseller = !!resellerOrder;

        // Compute effective price (tier-aware) — sequential for reseller (needs config fetch)
        let effectivePrice, markupPerUnit, applicableTier, nextTier;
        if (isReseller) {
            const freshConfig = await resellerVariantConfigRepository.findConfig(ctx, resellerOrder.resellerProductCode, resellerOrder.platformVariantCode);
            const config = freshConfig || { markup_type: resellerOrder.markup_type, markup_value: resellerOrder.markup_value, tier_overrides: {} };
            const rolePrice = await ctx.pricingService.calculatePriceForQty(variant, ownerId, newQuantity);
            applicableTier = ctx.pricingService.getApplicableTier(variant, newQuantity);
            nextTier = ctx.pricingService.getNextTier(variant, newQuantity);
            const { price } = resellerService.applyResellerPricing(rolePrice, config, applicableTier?.min_qty ?? null);
            effectivePrice = price;
            markupPerUnit = effectivePrice - rolePrice;
            // Sync markupPerUnit in state so voucher cap stays consistent
            await resellerState.setResellerOrder(userId, { ...resellerOrder, markupPerUnit });
        } else {
            effectivePrice = await ctx.pricingService.calculatePriceForQty(variant, ownerId, newQuantity);
            applicableTier = ctx.pricingService.getApplicableTier(variant, newQuantity);
            nextTier = ctx.pricingService.getNextTier(variant, newQuantity);
            markupPerUnit = 0;
        }

        // Fetch stock and product in parallel (independent of price computation)
        const [stockCount, product] = await Promise.all([
            isReseller
                ? stockRepository.countPlatformStock(variantCode)
                : stockRepository.countStock(ctx, variantCode),
            productRepository.findByCode(ctx, variant.code)
        ]);

        if (newQuantity < 1) {
            return ctx.reply('Jumlah pesanan tidak boleh kurang dari 1.');
        }

        if (newQuantity > stockCount) {
            return ctx.reply(`Stok tidak cukup. Tersedia: ${stockCount} pcs.`);
        }

        const subtotal = newQuantity * effectivePrice;
        const resellerContext = resellerOrder ? { markupPerUnit, quantity: newQuantity } : null;

        const [voucherDetails, buyerNotes, settings] = await Promise.all([
            orderService.getVoucherDetails(userId, subtotal, resellerContext),
            buyerNotesState.getAppliedNotes(userId),
            settingsService.getSettings(ctx)
        ]);
        const { voucherCode, voucherDiscount, isCapped, totalPrice } = voucherDetails;
        const saldoEnabled = settings?.saldoEnabled !== false;

        const displayVariantName = resellerOrder?.displayName || variant.name;
        const productName = product?.name || '';

        const tierHint = (applicableTier || nextTier) ? { applicableTier, nextTier } : null;

        const data = messageFormatter.formatOrderConfirmation({
            productName: productName,
            variantName: displayVariantName,
            price: effectivePrice,
            stockAvailable: stockCount,
            orderQuantity: newQuantity,
            totalPrice: totalPrice,
            voucherCode: voucherCode,
            voucherDiscount: voucherDiscount,
            subtotal: subtotal,
            isDiscountCapped: isCapped,
            buyerNotes: buyerNotes,
            tierHint
        });

        const { menuText, actionMap } = buildOrderMenuText({ saldoEnabled, voucherCode, buyerNotes });

        screenState.setScreen(userId, 'ORDER_CONFIRM', {
            variantCode,
            productCode: product?.code,
            actionMap,
            orderMessage: data
        });

        await ctx.reply(`${data}${menuText}`);
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = plusMinesStockProduct;
