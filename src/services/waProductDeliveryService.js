const waMessageFormatter = require('../utils/waMessageFormatter');
const fileDelivery = require('../utils/fileDelivery');
const { sendNotification, sendFileNotification } = require('../utils/waNotifications');
const { withRetry } = require('../utils/waRetry');

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
    appliedTier = null
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
