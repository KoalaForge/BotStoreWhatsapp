const transactionService = require("../services/transactionService");
const qrisService = require("../services/qrisService");
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const screenState = require('../state/screenState');

async function handleCustomTopUpInput(ctx) {
    try {
        // Handler for custom top-up nominal input
        if (!ctx.session || !ctx.session.waitingForTopUpNominal) {
            return; // Not waiting for top-up input
        }

        const message = ctx.message?.text || ctx.message?.conversation || '';
        const nominal = parseInt(message.replace(/[^0-9]/g, ''));

        // Reset session state
        ctx.session.waitingForTopUpNominal = false;

        // Validate nominal
        if (isNaN(nominal) || nominal < 5000) {
            return ctx.reply("*Nominal tidak valid.* Minimal top-up Rp 5.000.\n_Silakan coba lagi dengan /saldo_");
        }

        if (nominal > 10000000) {
            return ctx.reply("*Nominal terlalu besar.* Maksimal top-up Rp 10.000.000.\n_Silakan coba lagi dengan /saldo_");
        }

        // Check if user already has pending transaction
        const pendingTransaction = await transactionService.getPendingTransaction(ctx, ctx.from);
        if (pendingTransaction) {
            return ctx.reply("*Tidak bisa melakukan top-up, harap selesaikan transaksi sebelumnya.*");
        }

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
        });

    } catch (error) {
        console.error("Error handling custom top-up input:", error);
        await ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(error)}`);
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

module.exports = handleCustomTopUpInput;
