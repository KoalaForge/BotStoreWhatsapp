/**
 * WhatsApp Transaction Delivery Service
 *
 * Shared delivery logic used by BOTH:
 * 1. ProcessTransaction.js polling loop
 * 2. Transaction trigger API
 *
 * Adapted from Telegram's transactionDeliveryService.js for Baileys WhatsApp socket.
 * All functions receive (sock, context, transaction, ...) — no globals.
 */

const clc = require('cli-color');
const moment = require('moment-timezone');
const { formatMoney } = require('../database/models/money');
const { withRetry } = require('../utils/waRetry');

const transactionRepository = require('../repositories/TransactionRepository');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const productRepository = require('../repositories/ProductRepository');
const productVariantSnkRepository = require('../repositories/ProductVariantSnkRepository');
const botUserRepository = require('../repositories/BotUserRepository');
const repositoryContext = require('./repositoryContext');

const transactionService = require('./transactionService');
const modeService = require('./modeService');
const gatewayResolverService = require('./payment/GatewayResolverService');
const ownerBalanceService = require('./ownerBalanceService');
const voucherService = require('./voucherService');
const voucherState = require('../state/voucherState');
const transactionItemsHelper = require('../utils/transactionItemsHelper');
const waProductDeliveryService = require('./waProductDeliveryService');
const cycleService = require('./cycleService');
const waMessageFormatter = require('../utils/waMessageFormatter');
const { sendNotification } = require('../utils/waNotifications');
const { sendGroupAck } = require('../utils/groupReply');

// ---------------------------------------------------------------------------
// Balance description helper (inlined to avoid cross-project dependency)
// ---------------------------------------------------------------------------

function formatBalanceHistoryDescription(action, productName, variantName, quantity, platformTxId, ownerTxId) {
    return `${action} ${productName} - ${variantName} x${quantity} | ${platformTxId} → ${ownerTxId}`;
}

// ---------------------------------------------------------------------------
// Product display info resolution
// ---------------------------------------------------------------------------

/**
 * Resolve display information for a reseller order.
 * Uses platform variant lookup (bypasses OwnerScoped) and pulls display
 * names from transaction items when available.
 */
async function resolveResellerDisplayInfo(context, transaction, item) {
    const getVariantProduct = await productVariantRepository.findPlatformVariant(transaction.productCode);

    const hasItemInfo = item && (item.product_name || item.productInfo);
    let displayVariantName, getProduct;

    if (hasItemInfo) {
        const info = item.productInfo || { productName: item.product_name, productCode: item.product_code, variantName: item.variant_name };
        displayVariantName = info.variantName;
        getProduct = { name: info.productName, code: info.productCode };
    } else {
        displayVariantName = getVariantProduct?.name;
        getProduct = { name: 'Reseller Product', code: transaction.productCode };
    }

    const displayVariantPrice = (item && item.unit_price) ? item.unit_price : (getVariantProduct?.price || 0);

    let resellerInfo = null;
    if (item && item.cost_price != null) {
        const markupPerUnit = item.unit_price - item.cost_price;
        resellerInfo = {
            markupPerUnit,
            totalProfit: transaction.profit || 0
        };
    }

    const ProductVariantSnkModel = require('../database/models/productVariantSnkModels');
    const getVariantProductSnk = await ProductVariantSnkModel.findOne({
        codeVariant: transaction.productCode,
        ownerId: null
    });

    return { getVariantProduct, getProduct, displayVariantName, displayVariantPrice, getVariantProductSnk, resellerInfo };
}

/**
 * Resolve display information for a normal (non-reseller) order.
 */
async function resolveNormalDisplayInfo(context, transaction, item = null) {
    const getVariantProduct = await productVariantRepository.findByCodeVariant(context, transaction.productCode);
    const getProduct = await productRepository.findByCode(context, getVariantProduct.code);
    const getVariantProductSnk = await productVariantSnkRepository.findByCodeVariant(context, getVariantProduct.codeVariant);
    const displayVariantName = getVariantProduct?.name;
    const displayVariantPrice = (item && item.unit_price != null) ? item.unit_price : getVariantProduct.price;

    return { getVariantProduct, getProduct, displayVariantName, displayVariantPrice, getVariantProductSnk };
}

/**
 * Resolve product display info, delegating to reseller or normal path.
 */
async function resolveProductDisplayInfo(context, transaction, compatData) {
    const item = compatData.items?.length > 0 ? compatData.items[0] : null;

    if (transaction.is_reseller_order) {
        return resolveResellerDisplayInfo(context, transaction, item);
    }
    return resolveNormalDisplayInfo(context, transaction, item);
}

// ---------------------------------------------------------------------------
// Owner balance deduction
// ---------------------------------------------------------------------------

/**
 * Deduct owner balance for reseller QRIS orders after payment confirmation.
 * Only deducts when owner uses their own gateway (useOwnCredentials: true).
 * Idempotent via balance_deducted CAS flag.
 */
async function deductOwnerBalanceIfNeeded(context, transaction, compatData, displayInfo) {
    if (!transaction.is_reseller_order) return null;
    if (transaction.balance_deducted) return null;

    const { useOwnCredentials } = await gatewayResolverService.resolveGateway(transaction.ownerId);
    if (!useOwnCredentials) return null;

    const item = compatData.items?.[0];
    const costPrice = item?.cost_price || 0;
    const totalCost = costPrice * transaction.orderQuantity;
    if (totalCost <= 0) return null;

    const platformTxId = transaction.platform_reference || transaction.transactionId;
    const description = formatBalanceHistoryDescription(
        'Pembelian stok',
        displayInfo.getProduct.name,
        displayInfo.displayVariantName,
        transaction.orderQuantity,
        platformTxId,
        transaction.transactionId
    );

    const deductResult = await ownerBalanceService.deductForPurchase(transaction.ownerId, totalCost, {
        transactionId: transaction.transactionId,
        description: description
    });

    await transactionRepository.updateOneUnscoped(
        { transactionId: transaction.transactionId, balance_deducted: { $ne: true } },
        { $set: { balance_deducted: true } }
    );

    return deductResult;
}

// ---------------------------------------------------------------------------
// Delivery handlers
// ---------------------------------------------------------------------------

/**
 * Handle delivery of an owner platform top-up transaction.
 * Credits the owner's balance, sends a WhatsApp success message.
 */
async function handleOwnerTopUpDelivery(sock, context, transaction, paymentTimeString) {
    const ownerId = context.ownerId;

    const amountToAdd = transaction.topupAmount || transaction.totalPrice;

    // Exactly-once credit claim (owner records are unscoped: ownerId=null bypasses
    // OwnerScoped). Claimed BEFORE creditTopUp so a polling requery, the webhook
    // trigger, and concurrent processes can never credit the same topup twice.
    const claim = await transactionRepository.updateOneUnscoped(
        { transactionId: transaction.transactionId, balance_credited: { $ne: true } },
        { $set: { balance_credited: true } }
    );
    if (claim.modifiedCount === 0) {
        // Already credited by a prior attempt or another path. Settle delivery
        // to stop the requery loop — do NOT credit.
        await transactionRepository.updateOneUnscoped(
            { transactionId: transaction.transactionId },
            { $set: { isDelivered: true } }
        );
        console.log(clc.yellow.bold("[ WARN ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Skip duplicate owner top-up credit ${transaction.transactionId} (already credited) }`));
        return;
    }

    let creditResult;
    try {
        creditResult = await ownerBalanceService.creditTopUp(ownerId, amountToAdd, {
            transactionId: transaction.transactionId,
            description: `Top-up saldo platform ${formatMoney(amountToAdd)} via QRIS (${transaction.transactionId})`
        });
    } catch (err) {
        // Credit never landed — release the claim so a later retry can credit.
        await transactionRepository.updateOneUnscoped(
            { transactionId: transaction.transactionId },
            { $set: { balance_credited: false } }
        );
        throw err;
    }

    // Settle delivery RIGHT AFTER the credit, before the later platform-record
    // write, so a downstream failure can no longer trigger a re-credit.
    await transactionRepository.updateOneUnscoped(
        { transactionId: transaction.transactionId },
        { $set: { isDelivered: true } }
    );

    const message = waMessageFormatter.formatOwnerTopUpSuccessMessage({
        transactionId: transaction.transactionId,
        totalPrice: transaction.totalPrice,
        topupAmount: amountToAdd,
        gatewayFee: transaction.payment_fee || 0,
        newBalance: creditResult.newBalance
    });

    await withRetry(() => sock.sendMessage(transaction.chatId, { text: message }));

    await transactionService.createPlatformRecord({
        transactionId: transaction.transactionId,
        user_id: context.ownerId,
        transaction_type: 'topup',
        payment_method_code: transaction.payment_method_code || 'qris',
        orderChannel: transaction.orderChannel || 'whatsapp',
        formattedDate: transaction.formattedDate,
        payment_fee: transaction.payment_fee || 0,
        orderQuantity: 1,
        totalPrice: transaction.totalPrice,
        topupAmount: amountToAdd,
        profit: 0,
        chatId: transaction.chatId,
        messageId: transaction.messageId,
    });

    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Owner top-up berhasil: ${transaction.transactionId}, saldo baru: ${creditResult.newBalance} }`));
}

/**
 * Handle delivery of a top-up transaction.
 * Credits the user's balance, sends a WhatsApp success message, notifies admins.
 */
async function handleTopUpDelivery(sock, context, transaction, paymentTimeString) {
    const amountToAdd = transaction.topupAmount || transaction.totalPrice;

    // Exactly-once credit claim. Claimed atomically BEFORE the $inc so that a
    // polling requery (isSuccess:true, isDelivered:false), the webhook trigger,
    // and concurrent processes can never credit the same topup twice.
    const claim = await transactionRepository.updateOne(
        context,
        { transactionId: transaction.transactionId, balance_credited: { $ne: true } },
        { $set: { balance_credited: true } }
    );
    if (claim.modifiedCount === 0) {
        // Already credited by a prior attempt or another path. Settle delivery
        // to stop the requery loop — do NOT credit or re-message.
        await transactionRepository.updateOne(
            context,
            { transactionId: transaction.transactionId },
            { $set: { isDelivered: true } }
        );
        console.log(clc.yellow.bold("[ WARN ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Skip duplicate top-up credit ${transaction.transactionId} (already credited) }`));
        return;
    }

    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Berhasil memproses top-up saldo untuk user ${transaction.user_id} (${transaction.transactionId}) }`));

    let newBalance;
    try {
        newBalance = await transactionService.topUpBalance(
            context,
            transaction.user_id,
            amountToAdd
        );
    } catch (err) {
        // Credit never landed — release the claim so a later retry can credit.
        await transactionRepository.updateOne(
            context,
            { transactionId: transaction.transactionId },
            { $set: { balance_credited: false } }
        );
        throw err;
    }

    // Settle delivery RIGHT AFTER the credit, before the fallible admin
    // notification, so an unguarded send failure can no longer trigger a re-credit.
    await transactionRepository.updateOne(
        context,
        { transactionId: transaction.transactionId },
        { $set: { isDelivered: true } }
    );

    const message = waMessageFormatter.formatTopUpSuccessMessage({
        transactionId: transaction.transactionId,
        totalPrice: transaction.totalPrice,
        topupAmount: amountToAdd,
        gatewayFee: transaction.payment_fee || 0,
        newBalance: newBalance
    });

    await withRetry(() => sock.sendMessage(transaction.chatId, { text: message }));

    const userData = await botUserRepository.findByWhatsappId(context, transaction.user_id);
    const buyerName = userData?.name || null;
    const buyer = buyerName || transaction.user_id;

    const notificationMessage = waMessageFormatter.formatTopUpAdminNotification({
        transactionId: transaction.transactionId,
        buyer: buyer,
        totalPrice: transaction.totalPrice,
        topupAmount: amountToAdd,
        gatewayFee: transaction.payment_fee || 0,
        newBalance: newBalance,
        paymentDate: paymentTimeString
    });

    await sendNotification(sock, notificationMessage, context);

    // Post thank-you ack into the origin group when this top-up was initiated
    // from a group. Best-effort — group send must not block delivery.
    if (transaction.originGroupJid) {
        await sendGroupAck(sock, {
            groupJid: transaction.originGroupJid,
            senderJid: transaction.originSenderJid,
            senderPhone: transaction.user_id,
            messageId: transaction.originMessageId,
            text: `*Top-up ${formatMoney(amountToAdd)} berhasil.* Terima kasih.`
        }).catch(() => {});
    }
}

/**
 * Handle delivery of a product transaction.
 * Resolves product info (reseller vs normal), confirms voucher usage,
 * delivers the product to the customer, and marks as delivered.
 */
async function handleProductDelivery(sock, context, transaction, paymentTimeString) {
    const compatData = await transactionItemsHelper.getOrderDataCompat(context, transaction);
    const { orderData } = compatData;

    const displayInfo = await resolveProductDisplayInfo(context, transaction, compatData);
    const { getProduct, displayVariantName, displayVariantPrice, getVariantProductSnk } = displayInfo;
    let { resellerInfo } = displayInfo;

    const deductResult = await deductOwnerBalanceIfNeeded(context, transaction, compatData, displayInfo);
    if (deductResult && resellerInfo) {
        const item = compatData.items?.[0];
        const costPrice = item?.cost_price || 0;
        resellerInfo = {
            ...resellerInfo,
            costPerUnit: costPrice,
            totalCost: costPrice * transaction.orderQuantity,
            remainingBalance: deductResult.newBalance
        };
    }

    if (transaction.voucherCode) {
        const voucherConfirmed = await voucherService.confirmVoucherUsage(context, transaction.voucherCode);
        if (voucherConfirmed) {
            console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Voucher ${transaction.voucherCode} confirmed for transaction ${transaction.transactionId} }`));
            await voucherState.clearUserVoucherState(transaction.user_id);
        }
    }

    // For reseller orders: create platform record BEFORE delivery
    let platformRecord = null;
    if (transaction.is_reseller_order) {
        const item = compatData.items?.[0];
        const costPrice = item?.cost_price || 0;

        const platformSettlementFields = {};
        if (transaction.paid_at) platformSettlementFields.paid_at = transaction.paid_at;
        if (transaction.is_settled) {
            platformSettlementFields.is_settled = true;
            platformSettlementFields.settled_at = transaction.settled_at;
        }
        if (transaction.settle_expected_at) platformSettlementFields.settle_expected_at = transaction.settle_expected_at;

        platformRecord = await transactionService.createPlatformRecord({
            transactionId: transaction.transactionId,
            user_id: transaction.ownerId,
            transaction_type: 'product',
            payment_method_code: transaction.payment_method_code || 'qris',
            orderChannel: transaction.orderChannel || 'whatsapp',
            productCode: transaction.productCode,
            formattedDate: transaction.formattedDate,
            payment_fee: 0,
            orderQuantity: transaction.orderQuantity,
            totalPrice: costPrice * transaction.orderQuantity,
            chatId: transaction.chatId,
            messageId: transaction.messageId,
            is_reseller_order: true,
            balance_deducted: true,
            payment_status: 'paid',
            ...platformSettlementFields
        }, {
            items: [{
                codeVariant: transaction.productCode,
                quantity: transaction.orderQuantity,
                unitPrice: costPrice,
                stockItems: item?.data || [],
                productInfo: {
                    productCode: getProduct.code,
                    productName: getProduct.name,
                    variantName: displayVariantName
                }
            }]
        });

        if (platformRecord) {
            await transactionService.updatePlatformReference(context, transaction.transactionId, platformRecord.transactionId);
        } else {
            console.error(
                clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` +
                clc.redBright(` [CRITICAL] createPlatformRecord returned null for reseller order ${transaction.transactionId} (ownerId=${transaction.ownerId}). platform_reference NOT set. Manual reconciliation required.`)
            );
        }
    }

    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Berhasil mengirim data produk ke ${transaction.chatId} (${transaction.transactionId}) }`));

    const userData = await botUserRepository.findByWhatsappId(context, transaction.user_id);
    const buyerName = userData?.name || null;
    const buyer = buyerName || transaction.user_id;

    const appliedTier = compatData.items?.[0]?.applied_tier || null;

    await waProductDeliveryService.deliverProductToCustomer(sock, transaction.chatId, context, {
        transactionId: transaction.transactionId,
        productName: getProduct.name,
        variantName: displayVariantName,
        orderQuantity: transaction.orderQuantity,
        totalPrice: transaction.totalPrice,
        paymentDate: paymentTimeString,
        orderData: orderData,
        snkContent: getVariantProductSnk?.content || null,
        snkTermsAndConditions: getVariantProductSnk?.termsAndConditions || null,
        snkWarrantyTerms: getVariantProductSnk?.warrantyTerms || null,
        buyer: buyer,
        variantPrice: displayVariantPrice,
        voucherCode: transaction.voucherCode,
        voucherDiscount: transaction.voucherDiscount || 0,
        resellerInfo,
        buyer_notes: transaction.buyer_notes || null,
        appliedTier
    });

    await transactionRepository.updateOne(
        context,
        { transactionId: transaction.transactionId },
        { $set: { isDelivered: true } }
    );

    // Set cycle_eligible_at for cyclable variant items — skip for reseller orders
    if (!transaction.is_reseller_order) {
        const paidAt = transaction.paidAt || new Date();
        await cycleService.setCycleEligibilityForItems(context, transaction._id.toString(), paidAt);
    }

    if (transaction.is_reseller_order && platformRecord) {
        const paidAt = transaction.paidAt || new Date();
        await cycleService.setCycleEligibilityForPlatformItems(platformRecord._id, paidAt);
    }

    // Post thank-you ack into the origin group when this purchase was initiated
    // from a group via `.buy <code>`. Best-effort.
    if (transaction.originGroupJid) {
        await sendGroupAck(sock, {
            groupJid: transaction.originGroupJid,
            senderJid: transaction.originSenderJid,
            senderPhone: transaction.user_id,
            messageId: transaction.originMessageId,
            text: `*Pembelian ${getProduct.name} x${transaction.orderQuantity} berhasil.* Cek DM untuk detail. Terima kasih.`
        }).catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// Main entry point for API trigger
// ---------------------------------------------------------------------------

/**
 * Deliver a transaction that has been confirmed as paid.
 * Called by the trigger API after marking transaction as paid.
 *
 * @param {Object} sock - Baileys WebSocket connection
 * @param {Object} transaction - Transaction document (already marked isSuccess=true)
 * @param {string} paymentTimeString - Formatted payment time
 */
async function deliverTransaction(sock, transaction, paymentTimeString) {
    const context = await repositoryContext.createContext(transaction.botId, transaction.ownerId);
    const transactionType = transaction.transaction_type || 'product';
    const isOwnerTopUp = !modeService.isSingleMode() && transactionType === 'topup' && transaction.ownerId === null;

    // Delete the QRIS message
    try {
        if (transaction.messageId) {
            await withRetry(() => sock.sendMessage(transaction.chatId, {
                delete: {
                    remoteJid: transaction.chatId,
                    id: transaction.messageId,
                    fromMe: true
                }
            }));
        }
    } catch (err) {
        // Message might already be deleted — non-fatal
        console.warn(clc.yellow.bold("[ WARN ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Could not delete QRIS message for ${transaction.transactionId}: ${err.message}`));
    }

    if (isOwnerTopUp) {
        await handleOwnerTopUpDelivery(sock, context, transaction, paymentTimeString);
    } else if (transactionType === 'topup') {
        await handleTopUpDelivery(sock, context, transaction, paymentTimeString);
    } else {
        await handleProductDelivery(sock, context, transaction, paymentTimeString);
    }
}

module.exports = {
    deliverTransaction,
    handleOwnerTopUpDelivery,
    handleTopUpDelivery,
    handleProductDelivery,
    resolveProductDisplayInfo,
    deductOwnerBalanceIfNeeded,
};
