const botUserBalanceRepository = require("../repositories/BotUserBalanceRepository");
const stockRepository = require("../repositories/StockRepository");
const { formatMoney } = require("../database/models/money");
const messageFormatter = require("../utils/waMessageFormatter");
const orderService = require("../services/orderService");
const resellerState = require("../state/resellerState");
const buyerNotesState = require("../state/buyerNotesState");
const voucherState = require("../state/voucherState");
const screenState = require('../state/screenState');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');
const { isFeatureEnabled } = require('../utils/featureFlags');
const { getMessageText } = require('../utils/messageContext');

async function handlePayWithBalance(ctx) {
    try {
        if (!await isFeatureEnabled(ctx, 'saldoEnabled')) {
            return ctx.reply('Fitur saldo sedang tidak tersedia.');
        }

        const messageText = ctx.session?.lastOrderMessage || getMessageText(ctx);
        const orderAmountMatch = messageText.match(/Jumlah(?:\s*Pesanan)?[:\s*]*x?(\d+)/);
        const productMatch = messageText.match(/Produk[:\s*]*(.+?)(?:\n)/);
        const variantNameMatch = messageText.match(/Varia(?:nt|si)[:\s*]*(.+?)(?:\n)/);

        const orderAmount = orderAmountMatch ? parseInt(orderAmountMatch[1]) : null;
        const productName = productMatch ? productMatch[1].trim() : null;
        const variantName = variantNameMatch ? variantNameMatch[1].trim() : null;

        const userId = ctx.from;
        const [resellerOrder, buyerNotes] = await Promise.all([
            resellerState.getResellerOrder(userId),
            buyerNotesState.getAppliedNotes(userId)
        ]);

        // Resolve order context (works for both normal and reseller orders)
        const orderCtx = await orderService.resolveOrderContext(ctx, { productName, variantName, resellerOrder, quantity: orderAmount });
        const { product, variant, effectivePrice, isReseller, markupPerUnit, displayVariantName } = orderCtx;

        // Use orderService helper to get voucher details and calculate totals (with reseller cap)
        const subtotal = orderAmount * effectivePrice;
        const resellerContext = isReseller ? { markupPerUnit, quantity: orderAmount } : null;
        const voucherDetails = await orderService.getVoucherDetails(userId, subtotal, resellerContext);
        const { voucherCode, voucherDiscount, isCapped, totalPrice } = voucherDetails;

        // Check user balance
        const userBalance = await botUserBalanceRepository.findByUserId(ctx, ctx.from);
        const balance = userBalance?.balance || 0;

        if (balance < totalPrice) {
            return ctx.reply(`Saldo tidak cukup. Saldo: ${formatMoney(balance)}, Diperlukan: ${formatMoney(totalPrice)}`);
        }

        // Get stock count (platform for reseller, owner-scoped for normal)
        let stockCount;
        if (isReseller) {
            stockCount = await stockRepository.countPlatformStock(variant.codeVariant);
        } else {
            stockCount = await stockRepository.countStock(ctx, variant.codeVariant);
        }

        // Use messageFormatter to build confirmation message
        const data = messageFormatter.formatOrderConfirmation({
            productName: productName,
            variantName: displayVariantName,
            price: effectivePrice,
            stockAvailable: stockCount,
            orderQuantity: orderAmount,
            totalPrice: totalPrice,
            confirmationQuestion: 'Lanjutkan pembelian ini menggunakan saldo Anda?',
            variantLabel: 'Variasi',
            priceLabel: 'Harga satuan',
            showQuantityPrefix: true,
            voucherCode: voucherCode,
            voucherDiscount: voucherDiscount,
            subtotal: subtotal,
            isDiscountCapped: isCapped,
            buyerNotes: buyerNotes
        });

        // Store order message text in session for confirmPayBalance to parse
        if (!ctx.session) ctx.session = {};
        ctx.session.lastOrderMessage = data;

        // Get variantCode from voucherState for screen state
        const voucherInfo = await voucherState.getAppliedVoucher(userId);
        const variantCode = voucherInfo?.variantCode || variant?.codeVariant || null;

        // Set screen state for router (include order message for payment parsing)
        screenState.setScreen(userId, 'PAY_BALANCE_CONFIRM', {
            variantCode,
            orderMessage: data
        });

        await ctx.reply(`${data}\n\n*1.* Ya, Bayar\n*2.* Batal\n\n_Ketik nomor untuk memilih_`);

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = handlePayWithBalance;
