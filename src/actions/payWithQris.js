const transactionService = require("../services/transactionService");
const qrisService = require("../services/qrisService");
const orderService = require("../services/orderService");
const orderTransactionItemService = require("../services/orderTransactionItemService");
const ownerBalanceService = require("../services/ownerBalanceService");
const resellerState = require("../state/resellerState");
const buyerNotesState = require("../state/buyerNotesState");
const gatewayResolverService = require("../services/payment/GatewayResolverService");
const moment = require("moment-timezone");
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const { getMessageText } = require('../utils/messageContext');
const screenState = require('../state/screenState');

async function payWithQris(ctx) {
    // Tracks stock claimed before QRIS gen — restored on any post-claim failure
    let claimedStockItems = null;
    let isResellerOrder = false;

    try {
        // Parse order details from the last order message text
        const messageText = ctx.session?.lastOrderMessage || getMessageText(ctx);
        const orderDetails = orderService.parseOrderFromMessage(messageText);
        const { orderAmount, productName, variantName, price } = orderDetails;

        // Check for pending transaction
        const pendingTransaction = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pendingTransaction) {
            return ctx.reply("Harap selesaikan transaksi sebelumnya.");
        }

        const userId = ctx.from;
        const [resellerOrder, buyerNotes] = await Promise.all([
            resellerState.getResellerOrder(userId),
            buyerNotesState.getAppliedNotes(userId)
        ]);
        // Code-first lookup via screenState — prevents variant-name collisions
        // across products (e.g. multiple products with "HEAD 1 BULAN").
        const screenEntry = screenState.getScreen(userId);
        const productCodeFromState = screenEntry?.productCode || null;
        const variantCodeFromState = screenEntry?.variantCode || null;
        const orderCtx = await orderService.resolveOrderContext(ctx, {
            productName,
            variantName,
            productCode: productCodeFromState,
            variantCode: variantCodeFromState,
            resellerOrder,
            quantity: orderAmount
        });
        const { product, variant, effectivePrice, isReseller, markupPerUnit, displayVariantName } = orderCtx;
        isResellerOrder = isReseller;

        // Owner balance pre-check for reseller orders with own credentials
        const balanceValidation = await validateResellerBalanceIfNeeded(ctx, {
            isResellerOrder,
            ownerId: ctx.repositoryContext?.ownerId,
            effectivePrice,
            markupPerUnit,
            orderAmount
        });
        if (!balanceValidation.ok) {
            return ctx.reply(balanceValidation.message);
        }

        // Use orderService helper to get voucher details and calculate totals (with reseller cap)
        const resellerContext = isResellerOrder ? { markupPerUnit, quantity: orderAmount } : null;
        const orderCalculation = await orderService.calculateOrderTotal({
            userId: userId,
            quantity: orderAmount,
            unitPrice: effectivePrice,
            resellerContext
        });

        const { voucherCode, voucherDiscount, totalPrice: totalAmount } = orderCalculation;

        // CLAIM STOCK ATOMICALLY BEFORE generating QRIS.
        // Prevents race where multiple buyers receive QRIS for stock that no longer exists.
        // processOrderStock uses atomic deleteOne + deletedCount checks; only winners proceed.
        let stockResult;
        try {
            stockResult = await orderService.processOrderStock(ctx, {
                isReseller: isResellerOrder,
                variant,
                quantity: orderAmount,
                productInfo: {
                    productCode: product.code,
                    productName: product.name,
                    variantName: displayVariantName
                }
            });
        } catch (stockErr) {
            if (orderService.isStockUnavailableError(stockErr)) {
                return ctx.reply('Stok habis, tidak bisa melanjutkan.');
            }
            throw stockErr;
        }

        const { profit, stockItems } = stockResult;
        claimedStockItems = stockItems;

        await ctx.reply("⏳ Membuat QRIS pembayaran...");

        // Generate QRIS for product purchase (includes gateway fee calculation)
        const { qrisImage, transactionId, messageText: qrisMessage, formattedDate, formattedDateFile, gatewayFee, finalAmount, paymentMethodCode, gatewayReference } =
            await qrisService.generateProductQRIS({
                ctx,
                totalAmount,
                orderAmount,
                price: effectivePrice,
                productName,
                voucherCode,
                voucherDiscount
            });

        // Resolve QRIS image to a Buffer for WhatsApp
        const imageBuffer = resolveImageBuffer(qrisImage);

        // Convert HTML message to WhatsApp markdown
        const { htmlToWhatsApp } = require('../utils/waFormatter');
        const waMessage = htmlToWhatsApp(qrisMessage);

        // Send QRIS image with caption
        const sentMsg = await ctx.sendImage(imageBuffer, waMessage);

        // Send cancel instruction as plain text
        await ctx.reply('_Ketik *batal* untuk membatalkan pesanan_');

        // Extract message key for transaction tracking
        const msgKey = sentMsg?.key || null;
        const chatId = ctx.chat;
        const messageId = msgKey?.id || '0';

        const transactionProfit = orderService.calculateTransactionProfit({
            isReseller: isResellerOrder,
            markupPerUnit,
            quantity: orderAmount,
            stockProfit: profit,
            voucherDiscount
        });

        // Create pending transaction record
        await transactionService.createTransaction(ctx, {
            transactionId: transactionId,
            user_id: ctx.from,
            productCode: variant.codeVariant,
            orderQuantity: orderAmount,
            formattedDate: formattedDate,
            payment_fee: gatewayFee,
            totalPrice: finalAmount,
            chatId: chatId,
            messageId: messageId,
            profit: transactionProfit,
            transaction_type: "product",
            payment_method_code: paymentMethodCode,
            orderChannel: "whatsapp",
            isDelivered: false,
            voucherCode: voucherCode,
            voucherDiscount: voucherDiscount,
            gateway_reference: gatewayReference,
            is_reseller_order: isResellerOrder,
            buyer_notes: buyerNotes || null,
            originGroupJid: ctx.originGroupJid || null,
            originSenderJid: ctx.originGroupJid ? ctx.jid : null,
            originMessageId: ctx.originGroupJid ? (ctx.rawMessage?.key?.id || null) : null,
        });

        // Create transaction items (dual-write for web system compatibility)
        await orderTransactionItemService.createTransactionItems(ctx, transactionId, [{
            codeVariant: variant.codeVariant,
            quantity: orderAmount,
            unitPrice: effectivePrice,
            costPrice: isResellerOrder ? (effectivePrice - markupPerUnit) : null,
            stockItems: stockItems,
            productInfo: {
                productCode: product.code,
                productName: product.name,
                variantName: displayVariantName
            }
        }]);

        // Stock now bound to a persisted transaction — disarm rollback
        claimedStockItems = null;

        // Clear reseller, notes, and screen state after successful order creation
        screenState.clear(userId);
        const clearTasks = [];
        if (isResellerOrder) clearTasks.push(resellerState.clearResellerOrder(userId));
        if (buyerNotes) clearTasks.push(buyerNotesState.clearBuyerNotes(userId));
        if (clearTasks.length > 0) await Promise.all(clearTasks);

    } catch (err) {
        // Restore any stock claimed before the failure so it isn't lost
        if (claimedStockItems) {
            await orderService
                .restoreClaimedStock(ctx, { stockItems: claimedStockItems, isReseller: isResellerOrder })
                .catch((restoreErr) => console.error('[ payWithQris ] restore failed:', restoreErr.message));
            claimedStockItems = null;
        }
        console.error(`[ ERROR ] [${moment().format("YYYY-MM-DD HH:mm:ss")}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

/**
 * Resolve QRIS image to a Buffer for WhatsApp sending.
 * Handles Buffer, URL string, data URI, and raw base64 string.
 * @param {Buffer|string} qrisImage
 * @returns {Buffer}
 */
function resolveImageBuffer(qrisImage) {
    if (Buffer.isBuffer(qrisImage)) {
        return qrisImage;
    }
    if (typeof qrisImage === 'string') {
        if (qrisImage.startsWith('data:')) {
            return Buffer.from(qrisImage.split(',')[1], 'base64');
        }
        if (/^https?:\/\//i.test(qrisImage)) {
            // URL — return as-is, ctx.sendImage should handle URLs
            return qrisImage;
        }
        // Raw base64
        return Buffer.from(qrisImage, 'base64');
    }
    return qrisImage;
}

/**
 * Validate owner balance for reseller orders when using own payment gateway credentials
 * @param {Object} ctx - WhatsApp context
 * @param {Object} params - Validation parameters
 * @param {boolean} params.isResellerOrder - Whether this is a reseller order
 * @param {string} params.ownerId - Owner ID
 * @param {number} params.effectivePrice - Price per unit
 * @param {number} params.markupPerUnit - Markup per unit
 * @param {number} params.orderAmount - Quantity ordered
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function validateResellerBalanceIfNeeded(ctx, { isResellerOrder, ownerId, effectivePrice, markupPerUnit, orderAmount }) {
    if (!isResellerOrder) {
        return { ok: true };
    }

    const { useOwnCredentials } = await gatewayResolverService.resolveGateway(ownerId);
    if (!useOwnCredentials) {
        return { ok: true };
    }

    const costPerUnit = effectivePrice - markupPerUnit;
    return await ownerBalanceService.validateResellerBalance(ownerId, { isResellerOrder, costPerUnit, quantity: orderAmount });
}

module.exports = payWithQris;
