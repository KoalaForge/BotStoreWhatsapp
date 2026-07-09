const moment = require("moment-timezone");
const transactionService = require("../services/transactionService");
const orderService = require("../services/orderService");
const { isFeatureEnabled } = require('../utils/featureFlags');
const orderTransactionItemService = require("../services/orderTransactionItemService");
const ownerBalanceService = require("../services/ownerBalanceService");
const modeService = require("../services/modeService");
const productVariantSnkModel = require("../database/models/productVariantSnkModels");
const botUserModel = require("../database/models/botUserModels");
const voucherState = require("../state/voucherState");
const voucherService = require("../services/voucherService");
const resellerState = require("../state/resellerState");
const buyerNotesState = require("../state/buyerNotesState");
const { formatMoney } = require("../database/models/money");
const cycleService = require('../services/cycleService');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const { getMessageText } = require('../utils/messageContext');
const screenState = require('../state/screenState');
const { jidQuery } = require('../utils/jidHelper');
const { sendGroupAck } = require('../utils/groupReply');
const variantAccessGuard = require('../services/variantAccessGuard');

/**
 * Centralized function to format balance history description with transaction IDs
 * Format: "{action} {product} - {variant} x{qty} | {platformTxId} -> {ownerTxId}"
 */
function formatBalanceHistoryDescription(action, productName, variantName, quantity, platformTxId, ownerTxId) {
    return `${action} ${productName} - ${variantName} x${quantity} | ${platformTxId} → ${ownerTxId}`;
}

async function confirmPayBalance(ctx) {
    // Tracks stock claimed before balance deduct — restored on any post-claim failure
    let claimedStockItems = null;
    let isResellerOrder = false;

    try {
        if (!await isFeatureEnabled(ctx, 'saldoEnabled')) {
            return ctx.reply('Fitur saldo sedang tidak tersedia.');
        }

        // Check for pending transaction before processing (early exit, keep confirmation message)
        const pendingTransaction = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pendingTransaction) {
            return ctx.reply("Harap selesaikan transaksi sebelumnya.");
        }

        // Recover group-origin metadata seeded by prepareOrder (if user triggered
        // this purchase from a group via `.buynow`). Lost from ctx because the
        // confirm step (`1` in DM) arrives as a fresh native-DM message.
        const screenEntry = screenState.getScreen(ctx.from);
        const originGroupJid = ctx.originGroupJid || screenEntry?.originGroupJid || null;
        const originSenderJid = originGroupJid
            ? (ctx.originGroupJid ? ctx.jid : screenEntry?.originSenderJid || null)
            : null;
        const originMessageId = originGroupJid
            ? (ctx.originGroupJid ? (ctx.rawMessage?.key?.id || null) : screenEntry?.originMessageId || null)
            : null;

        // Parse order details from session or message
        const messageText = ctx.session?.lastOrderMessage || getMessageText(ctx);
        const orderDetails = orderService.parseOrderFromMessage(messageText);
        const { orderAmount, productName, variantName } = orderDetails;

        const userId = ctx.from;
        const [resellerOrder, buyerNotes] = await Promise.all([
            resellerState.getResellerOrder(userId),
            buyerNotesState.getAppliedNotes(userId)
        ]);
        // Code-first lookup via screenState — prevents variant-name collisions
        // across products (e.g. multiple products with "HEAD 1 BULAN").
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

        // Per-variant access guard (ban + whitelist; both default off)
        const accessGuard = await variantAccessGuard.checkPayment(ctx, userId, variant.codeVariant, product.code, {
            productRequiresWhitelist: product.requiresWhitelist === true,
            variantRequiresWhitelist: variant.requiresWhitelist === true
        });
        if (!accessGuard.allowed) {
            return ctx.reply(accessGuard.message);
        }

        // Owner balance pre-check for reseller orders
        if (isResellerOrder) {
            const ownerId = ctx.repositoryContext?.ownerId;
            const costPerUnit = effectivePrice - markupPerUnit;
            const balanceCheck = await ownerBalanceService.validateResellerBalance(ownerId, { isResellerOrder, costPerUnit, quantity: orderAmount });
            if (!balanceCheck.ok) {
                return ctx.reply(balanceCheck.message);
            }
        }

        // Use orderService helper to get voucher details and calculate totals (with reseller cap)
        const subtotal = orderAmount * effectivePrice;
        const resellerContext = isResellerOrder ? { markupPerUnit, quantity: orderAmount } : null;
        const voucherDetails = await orderService.getVoucherDetails(userId, subtotal, resellerContext);
        const { voucherCode, voucherDiscount, totalPrice } = voucherDetails;

        // Check user balance BEFORE claiming stock — fail fast on insufficient balance
        const balance = await transactionService.getUserBalance(ctx, userId);

        if (balance < totalPrice) {
            return ctx.reply(`Saldo tidak cukup. Saldo: ${formatMoney(balance)}, Diperlukan: ${formatMoney(totalPrice)}`);
        }

        // CLAIM STOCK ATOMICALLY BEFORE deducting balance.
        // Race-safe via deleteOne+deletedCount; only winners proceed past this point.
        // Done before deleteMessage so failed buyers still see the confirmation message.
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

        const { dataStock, profit, stockItems } = stockResult;
        claimedStockItems = stockItems;

        // Stock secured — now safe to consume the confirmation message + show processing toast
        await ctx.reply('Memproses pesanan...');
        try {
            if (ctx.messageKey) await ctx.deleteMessage(ctx.messageKey);
        } catch (_e) { /* ignore */ }

        // Deduct balance and get new balance
        const newBalance = await transactionService.deductBalance(ctx, userId, totalPrice);

        const formattedDate = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");
        const uniqCode = await transactionService.generateTransactionId("product", ctx);

        const transactionProfit = orderService.calculateTransactionProfit({
            isReseller: isResellerOrder,
            markupPerUnit,
            quantity: orderAmount,
            stockProfit: profit,
            voucherDiscount
        });

        // Balance payment is auto-settled (no waiting period)
        const paidAt = new Date();
        const settlementFields = modeService.isMultiMode() ? {
            paid_at: paidAt,
            is_settled: true,
            settled_at: paidAt
        } : {};

        // Create platform record FIRST for reseller orders
        let platformRecord = null;
        let ownerBalanceDeductResult = null;
        if (isResellerOrder) {
            const costPerUnit = effectivePrice - markupPerUnit;
            platformRecord = await transactionService.createPlatformRecord({
                transactionId: uniqCode,
                user_id: ctx.repositoryContext?.ownerId,
                transaction_type: 'product',
                payment_method_code: 'balance',
                orderChannel: 'whatsapp',
                productCode: variant.codeVariant,
                formattedDate: formattedDate,
                payment_fee: 0,
                orderQuantity: orderAmount,
                totalPrice: costPerUnit * orderAmount,
                chatId: ctx.chat,
                messageId: '0',
                is_reseller_order: true,
                balance_deducted: true,
                payment_status: 'paid'
            }, {
                items: [{
                    codeVariant: variant.codeVariant,
                    quantity: orderAmount,
                    unitPrice: costPerUnit,
                    stockItems: stockItems,
                    productInfo: {
                        productCode: product.code,
                        productName: product.name,
                        variantName: displayVariantName
                    }
                }]
            });

            if (platformRecord) {
                await transactionService.updatePlatformReference(ctx, uniqCode, platformRecord.transactionId);
                await cycleService.setCycleEligibilityForPlatformItems(platformRecord._id, paidAt);
            }
        }

        // Deduct owner balance AFTER platform record created
        if (isResellerOrder) {
            const ownerId = ctx.repositoryContext?.ownerId;
            const costPerUnit = effectivePrice - markupPerUnit;
            const totalCost = costPerUnit * orderAmount;
            const platformTxId = platformRecord?.transactionId || uniqCode;

            ownerBalanceDeductResult = await ownerBalanceService.deductForPurchase(ownerId, totalCost, {
                transactionId: uniqCode,
                description: formatBalanceHistoryDescription(
                    'Pembelian stok',
                    product.name,
                    displayVariantName,
                    orderAmount,
                    platformTxId,
                    uniqCode
                )
            });
        }

        // Create transaction record
        await transactionService.createTransaction(ctx, {
            transactionId: uniqCode,
            user_id: userId,
            transaction_type: "product",
            payment_method_code: "balance",
            orderChannel: "whatsapp",
            productCode: variant.codeVariant,
            orderQuantity: orderAmount,
            formattedDate: formattedDate,
            payment_fee: 0,
            totalPrice: totalPrice,
            chatId: ctx.chat,
            messageId: "0",
            profit: transactionProfit,
            isSuccess: true,
            isDelivered: true,
            voucherCode: voucherCode,
            voucherDiscount: voucherDiscount,
            is_reseller_order: isResellerOrder,
            balance_deducted: !!ownerBalanceDeductResult,
            buyer_notes: buyerNotes || null,
            originGroupJid,
            originSenderJid,
            originMessageId,
            ...settlementFields
        });

        // Create transaction items (dual-write for web system compatibility)
        await orderTransactionItemService.createTransactionItems(ctx, uniqCode, [{
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

        // Stock now persisted on transaction items — disarm rollback
        claimedStockItems = null;

        // Set cycle eligibility for normal (non-reseller) orders
        if (!isResellerOrder) {
            await cycleService.setCycleEligibilityByTransactionId(ctx, uniqCode, paidAt);
        }

        // Clear reseller, notes, and screen state after successful order
        screenState.clear(userId);
        const clearTasks = [];
        if (isResellerOrder) clearTasks.push(resellerState.clearResellerOrder(userId));
        if (buyerNotes) clearTasks.push(buyerNotesState.clearBuyerNotes(userId));
        if (clearTasks.length > 0) await Promise.all(clearTasks);

        // Confirm voucher usage (increment used_count)
        if (voucherCode) {
            await voucherService.confirmVoucherUsage(ctx, voucherCode);
            await voucherState.clearUserVoucherState(userId);
        }

        // Get SNK content — for reseller, use platform SNK (ownerId=null).
        // For non-reseller, scope to the variant's owner; codeVariant is NOT
        // unique across tenants, and a lookup without ownerId would return
        // another tenant's SNK.
        const snkQuery = {
            codeVariant: variant.codeVariant,
            ownerId: isResellerOrder ? null : (variant.ownerId ?? null),
        };
        const variantSnk = await productVariantSnkModel.findOne(snkQuery);

        // Get buyer info for admin notification
        const userData = await botUserModel.findOne(jidQuery('idWhatsapp', userId));
        const buyerPhone = ctx.phoneNumber || userId;
        const buyer = buyerPhone;

        // Build reseller info for admin notification
        const resellerInfo = isResellerOrder ? {
            markupPerUnit,
            totalProfit: transactionProfit,
            costPerUnit: effectivePrice - markupPerUnit,
            totalCost: (effectivePrice - markupPerUnit) * orderAmount,
            remainingBalance: ownerBalanceDeductResult?.newBalance ?? 0
        } : null;

        // Deliver product to customer via WhatsApp
        // Uses waProductDeliveryService when available, fallback to direct message
        try {
            const productDeliveryService = require("../services/waProductDeliveryService");
            await productDeliveryService.deliverProductToCustomer(ctx.sock, ctx.chat, ctx, {
                transactionId: uniqCode,
                productName: product.name,
                variantName: displayVariantName,
                orderQuantity: orderAmount,
                totalPrice: totalPrice,
                paymentDate: formattedDate,
                orderData: dataStock,
                snkContent: variantSnk?.content || null,
                snkTermsAndConditions: variantSnk?.termsAndConditions || null,
                snkWarrantyTerms: variantSnk?.warrantyTerms || null,
                buyer: buyer,
                variantPrice: effectivePrice,
                payment_method_code: "balance",
                newBalance: newBalance,
                voucherCode: voucherCode,
                voucherDiscount: voucherDiscount,
                resellerInfo,
                buyer_notes: buyerNotes || null
            });
        } catch (deliveryErr) {
            // Fallback: send basic delivery message + admin notification
            console.error('Product delivery service error, using fallback:', deliveryErr.message);
            const { parseOrderData } = require('../utils/parser');
            const { sendNotification } = require('../utils/waNotifications');
            const orderData = parseOrderData(dataStock);

            let msg = `*Pesanan Berhasil!*\n\n`;
            msg += `*ID:* \`${uniqCode}\`\n`;
            msg += `*Produk:* ${product.name}\n`;
            msg += `*Variasi:* ${displayVariantName}\n`;
            msg += `*Jumlah:* ${orderAmount}x\n`;
            msg += `*Total:* ${formatMoney(totalPrice)}\n`;
            msg += `*Pembayaran:* Saldo\n`;
            msg += `*Sisa Saldo:* ${formatMoney(newBalance)}\n\n`;
            msg += `*Data Pesanan:*\n\`\`\`\n${orderData}\n\`\`\``;

            if (variantSnk?.content) {
                msg += `\n\n*Syarat & Ketentuan:*\n${variantSnk.content}`;
            }

            await ctx.reply(msg);

            // Admin notification (fallback)
            const adminMsg = `*Pesanan Baru (Saldo)*\n\n` +
                `*ID:* \`${uniqCode}\`\n` +
                `*Pembeli:* ${buyer}\n` +
                `*Produk:* ${product.name} — ${displayVariantName}\n` +
                `*Jumlah:* ${orderAmount}x\n` +
                `*Total:* ${formatMoney(totalPrice)}\n` +
                `*Waktu:* ${formattedDate}`;
            await sendNotification(ctx.sock, adminMsg, ctx).catch(() => {});
        }

        // Post a thank-you ack into the origin group (if this purchase started
        // from `.buynow` in a group). Best-effort — group send failures must
        // not invalidate a delivered purchase.
        if (originGroupJid) {
            await sendGroupAck(ctx.sock, {
                groupJid: originGroupJid,
                senderJid: originSenderJid,
                senderPhone: userId,
                messageId: originMessageId,
                text: `*Pembelian ${product.name} x${orderAmount} berhasil.* Cek DM untuk detail. Terima kasih.`
            }).catch(() => {});
        }

    } catch (err) {
        // Restore any stock claimed before the failure so it isn't lost.
        // Disarmed after createTransactionItems — past that point the tx record
        // owns the stock and admin handles redelivery/refund manually.
        if (claimedStockItems) {
            await orderService
                .restoreClaimedStock(ctx, { stockItems: claimedStockItems, isReseller: isResellerOrder })
                .catch((restoreErr) => console.error('[ confirmPayBalance ] restore failed:', restoreErr.message));
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

module.exports = confirmPayBalance;
module.exports.formatBalanceHistoryDescription = formatBalanceHistoryDescription;
