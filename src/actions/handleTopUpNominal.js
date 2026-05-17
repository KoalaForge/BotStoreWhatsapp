const transactionService = require("../services/transactionService");
const qrisService = require("../services/qrisService");
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const screenState = require('../state/screenState');

async function handleTopUpNominal(ctx) {
    try {
        // Extract nominal from callback data: "topup-{amount}" (legacy) or "topup:{amount}" (modern)
        const callbackData = ctx.callbackData || '';
        const nominalMatch = callbackData.match(/^topup[-:](\d+)$/);

        if (!nominalMatch) {
            return ctx.reply("Nominal tidak valid.");
        }

        const nominal = parseInt(nominalMatch[1]);

        // Check if user already has pending transaction
        const pendingTransaction = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pendingTransaction) {
            return ctx.reply("Harap selesaikan transaksi sebelumnya.");
        }

        await ctx.reply("⏳ Membuat QRIS pembayaran...");

        // Generate QRIS for top-up (includes gateway fee calculation)
        const { qrisImage, transactionId, messageText, formattedDate, formattedDateFile, fee, totalAmount, originalAmount, paymentMethodCode, gatewayReference } =
            await qrisService.generateTopUpQRIS({ ctx, nominal });

        // Resolve QRIS image to Buffer for WhatsApp
        const imageBuffer = resolveImageBuffer(qrisImage);

        // Convert HTML message to WhatsApp markdown
        const { htmlToWhatsApp } = require('../utils/waFormatter');
        const waMessage = htmlToWhatsApp(messageText);

        // Send QRIS image with caption
        const sentMsg = await ctx.sendImage(imageBuffer, waMessage);

        // Send cancel instruction as plain text
        await ctx.reply('_Ketik *batal* untuk membatalkan_');

        // Extract message key for transaction tracking
        const msgKey = sentMsg?.key || null;
        const chatId = ctx.chat;
        const messageId = msgKey?.id || '0';

        // Clear screen state — user is now in payment flow
        screenState.clear(ctx.from);

        // Create transaction record
        await transactionService.createTransaction(ctx, {
            transactionId: transactionId,
            user_id: ctx.from,
            transaction_type: 'topup',
            payment_method_code: paymentMethodCode,
            orderChannel: 'whatsapp',
            formattedDate: formattedDate,
            payment_fee: fee,
            totalPrice: totalAmount,
            profit: 0,
            chatId: chatId,
            messageId: messageId,
            isDelivered: false,
            topupAmount: originalAmount,
            gateway_reference: gatewayReference,
            originGroupJid: ctx.originGroupJid || null,
            originSenderJid: ctx.originGroupJid ? ctx.jid : null,
            originMessageId: ctx.originGroupJid ? (ctx.rawMessage?.key?.id || null) : null,
        });

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

/**
 * Resolve QRIS image to a Buffer for WhatsApp sending.
 * @param {Buffer|string} qrisImage
 * @returns {Buffer|string}
 */
function resolveImageBuffer(qrisImage) {
    if (Buffer.isBuffer(qrisImage)) return qrisImage;
    if (typeof qrisImage === 'string') {
        if (qrisImage.startsWith('data:')) return Buffer.from(qrisImage.split(',')[1], 'base64');
        if (/^https?:\/\//i.test(qrisImage)) return qrisImage;
        return Buffer.from(qrisImage, 'base64');
    }
    return qrisImage;
}

module.exports = handleTopUpNominal;
