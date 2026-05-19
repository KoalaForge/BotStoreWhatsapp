const orderService = require("../services/orderService");
const buyerNotesState = require("../state/buyerNotesState");
const settingsService = require("../services/settingsService");
const messageFormatter = require("../utils/waMessageFormatter");
const { buildOrderMenuText } = require("../utils/orderMenuText");
const productRepository = require("../repositories/ProductRepository");
const productVariantRepository = require("../repositories/ProductVariantRepository");
const screenState = require('../state/screenState');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const { getMessageText } = require('../utils/messageContext');

async function cancelPayBalance(ctx) {
    try {
        // Parse order details from session or message
        const messageText = ctx.session?.lastOrderMessage || getMessageText(ctx);
        const orderDetails = orderService.parseOrderFromMessage(messageText);
        const { orderAmount, productName, variantName, price, stockAvailable } = orderDetails;

        // Calculate subtotal and apply voucher if exists
        const userId = ctx.from;
        const subtotal = orderAmount * price;
        const [voucherDetails, buyerNotes, settings] = await Promise.all([
            orderService.getVoucherDetails(userId, subtotal, null),
            buyerNotesState.getAppliedNotes(userId),
            settingsService.getSettings(ctx)
        ]);
        const { voucherCode, voucherDiscount, totalPrice } = voucherDetails;
        const saldoEnabled = settings?.saldoEnabled !== false;

        // Code-first lookup: prefer codes persisted in screenState — name alone
        // is ambiguous when multiple products share a variant name.
        const screenEntry = screenState.getScreen(userId);
        let productCode = screenEntry?.productCode || null;
        let variantCodeFromState = screenEntry?.variantCode || null;

        if (!productCode && productName) {
            const product = await productRepository.findOne(ctx, { name: { $regex: new RegExp('^' + productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i') } });
            productCode = product ? product.code : null;
        }

        let variant = null;
        if (variantCodeFromState) {
            variant = await productVariantRepository.findByCodeVariant(ctx, variantCodeFromState);
        } else if (productCode && variantName) {
            variant = await productVariantRepository.findOne(ctx, {
                name: { $regex: new RegExp('^' + variantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i') },
                code: productCode
            });
        }
        if (variant && variant.code) {
            productCode = variant.code;
        }
        const variantCode = variant ? variant.codeVariant : null;

        const data = messageFormatter.formatOrderConfirmation({
            productName: productName,
            variantName: variantName,
            price: price,
            stockAvailable: stockAvailable,
            orderQuantity: orderAmount,
            totalPrice: totalPrice,
            voucherCode: voucherCode,
            voucherDiscount: voucherDiscount,
            subtotal: subtotal,
            buyerNotes: buyerNotes
        });

        const { menuText, actionMap } = buildOrderMenuText({ saldoEnabled, voucherCode, buyerNotes });

        if (!ctx.session) ctx.session = {};
        ctx.session.lastOrderMessage = data;

        screenState.setScreen(userId, 'ORDER_CONFIRM', {
            variantCode,
            productCode,
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

module.exports = cancelPayBalance;
