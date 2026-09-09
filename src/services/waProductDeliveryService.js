const waMessageFormatter = require('../utils/waMessageFormatter');
const fileDelivery = require('../utils/fileDelivery');
const { sendNotification, sendFileNotification } = require('../utils/waNotifications');
const { withRetry } = require('../utils/waRetry');
const ratingApiService = require('./ratingApiService');
const screenState = require('../state/screenState');
const { stripPhone } = require('../utils/jidHelper');
const settingsService = require('./settingsService');

async function sendRatingPrompt(sock, jid, context, { transactionId, ratingUserId, productName, variantName }) {
    try {
        if (!ratingApiService.isConfigured()) return;
        const botId = context?.state?.botId
            ?? context?.repositoryContext?.botId
            ?? context?.botId
            ?? null;
        const settings = await settingsService.getSettingsByBotId(botId).catch(() => null);
        if (settings?.ratingEnabled === false) return;

        const userId = stripPhone(ratingUserId || jid);
        const shouldPrompt = await ratingApiService.claimPrompt({
            transactionId,
            channelUserId: userId
        });
        if (!shouldPrompt) return;

        const canUseShortReply = !screenState.getScreen(userId);
        const replyInstructions = canUseShortReply
            ? `Balas 1-5 dalam 15 menit. Setelah memilih nilai, kamu bisa menambahkan komentar opsional.\n` +
                `Ketik \`lewati\` untuk melewati rating. Rating tetap tersedia selama 24 jam.\n\n` +
                `Setelah 15 menit, kirim \`.rating ${transactionId} <1-5>\` atau \`.rating skip ${transactionId}\`.`
            : `Rating tersedia selama 24 jam. Kirim \`.rating ${transactionId} <1-5>\` atau \`.rating skip ${transactionId}\`.`;
        const choiceHeading = canUseShortReply
            ? 'Balas dengan salah satu pilihan berikut:'
            : 'Pilih nilai untuk perintah rating:';

        const prompt = `*Beri Rating Produk*\n\n` +
            `*Produk:* ${productName}\n` +
            `*Variasi:* ${variantName}\n\n` +
            `${choiceHeading}\n` +
            `1 - Sangat buruk\n` +
            `2 - Buruk\n` +
            `3 - Cukup\n` +
            `4 - Baik\n` +
            `5 - Sangat baik\n\n` +
            replyInstructions;

        const sent = await withRetry(async () => {
            await sock.sendMessage(jid, { text: prompt });
            return true;
        });
        if (sent && canUseShortReply && !screenState.getScreen(userId)) {
            screenState.setScreen(userId, 'RATING_INPUT', { transactionId });
        }
    } catch (error) {
        console.error(`[rating] Failed to send delivery prompt for ${transactionId}:`, error.message);
    }
}

/**
 * Deliver product to customer after successful payment (WhatsApp version).
 * Handles both regular message (qty <= 5) and file delivery (qty > 5).
 *
 * @param {Object} sock - Baileys WebSocket connection
 * @param {string} jid - Customer WhatsApp JID
 * @param {Object} context - Repository context (with botId, ownerId, etc.)
 * @param {Object} params - Delivery parameters
 */
async function deliverProductToCustomer(sock, jid, context, {
    transactionId,
    ratingUserId = null,
    productName,
    variantName,
    orderQuantity,
    totalPrice,
    paymentDate,
    orderData,
    snkContent = null,
    snkTermsAndConditions = null,
    snkWarrantyTerms = null,
    buyer,
    variantPrice,
    payment_method_code = 'qris',
    newBalance = null,
    voucherCode = null,
    voucherDiscount = 0,
    resellerInfo = null,
    buyer_notes = null,
    appliedTier = null,
    ratingEligible = false
}) {
    let shouldSendAsFile = fileDelivery.shouldDeliverAsFile(orderQuantity);

    // Even for small quantities, fall back to file when the rendered message
    // would exceed WhatsApp's length limit (e.g. one very long stock entry).
    // Both customer and admin messages embed the order data, so check both.
    let customerMessage = null;
    if (!shouldSendAsFile) {
        customerMessage = waMessageFormatter.formatProductSuccessMessage({
            transactionId,
            productName,
            variantName,
            orderQuantity,
            totalPrice,
            payment_method_code,
            paymentDate,
            orderData,
            snkContent,
            snkTermsAndConditions,
            snkWarrantyTerms,
            newBalance,
            voucherCode,
            voucherDiscount
        });

        const adminPreview = waMessageFormatter.formatProductAdminNotification({
            transactionId,
            buyer,
            productName,
            variantName,
            variantPrice,
            orderQuantity,
            totalPrice,
            payment_method_code,
            paymentDate,
            orderData,
            voucherCode,
            voucherDiscount,
            resellerInfo,
            buyer_notes,
            appliedTier
        });

        if (fileDelivery.exceedsMessageLimit(customerMessage) || fileDelivery.exceedsMessageLimit(adminPreview)) {
            shouldSendAsFile = true;
        }
    }

    if (shouldSendAsFile) {
        // QUANTITY > 5: Send summary message + file attachment

        const summaryMessage = waMessageFormatter.formatProductSuccessMessageSummary({
            transactionId,
            productName,
            variantName,
            orderQuantity,
            totalPrice,
            payment_method_code,
            paymentDate,
            snkContent,
            snkTermsAndConditions,
            snkWarrantyTerms,
            newBalance,
            voucherCode,
            voucherDiscount
        });

        await withRetry(() => sock.sendMessage(jid, { text: summaryMessage }));

        // Generate file content and send as Buffer (no temp files)
        const fileContent = fileDelivery.generateFileContent({
            transactionId,
            productName,
            variantName,
            orderData,
            orderQuantity
        });

        const fileBuffer = Buffer.from(fileContent, 'utf-8');
        const fileName = `${transactionId}.txt`;

        await withRetry(() => sock.sendMessage(jid, {
            document: fileBuffer,
            fileName,
            mimetype: 'text/plain',
            caption: `Data pembelian untuk transaksi \`${transactionId}\``
        }));

        if (ratingEligible) {
            await sendRatingPrompt(sock, jid, context, { transactionId, ratingUserId, productName, variantName });
        }

        // Send summary notification to admin
        const adminSummaryMessage = waMessageFormatter.formatProductAdminNotificationSummary({
            transactionId,
            buyer,
            productName,
            variantName,
            variantPrice,
            orderQuantity,
            totalPrice,
            payment_method_code,
            paymentDate,
            voucherCode,
            voucherDiscount,
            resellerInfo,
            buyer_notes,
            appliedTier
        });

        await sendNotification(sock, adminSummaryMessage, context);

        // Send file to admin
        await sendFileNotification(
            sock,
            fileBuffer,
            fileName,
            context,
            `Data pembelian: \`${transactionId}\` | ${buyer}`
        );

    } else {
        // QUANTITY <= 5 and within length limit: send as regular message
        // (customerMessage was already built above for the length check)

        await withRetry(() => sock.sendMessage(jid, { text: customerMessage }));

        if (ratingEligible) {
            await sendRatingPrompt(sock, jid, context, { transactionId, ratingUserId, productName, variantName });
        }

        // Send notification to admin
        const notificationMessage = waMessageFormatter.formatProductAdminNotification({
            transactionId,
            buyer,
            productName,
            variantName,
            variantPrice,
            orderQuantity,
            totalPrice,
            payment_method_code,
            paymentDate,
            orderData,
            voucherCode,
            voucherDiscount,
            resellerInfo,
            buyer_notes,
            appliedTier
        });

        await sendNotification(sock, notificationMessage, context);
    }
}

module.exports = {
    deliverProductToCustomer
};
