const buyerNotesState = require('../state/buyerNotesState');
const voucherState = require('../state/voucherState');
const settingsService = require('../services/settingsService');
const { buildOrderMenuText } = require('../utils/orderMenuText');
const messageFormatter = require('../utils/waMessageFormatter');
const orderService = require('../services/orderService');
const resellerState = require('../state/resellerState');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const productRepository = require('../repositories/ProductRepository');
const stockRepository = require('../repositories/StockRepository');
const screenState = require('../state/screenState');
const moment = require('moment-timezone');

const MAX_NOTES_LENGTH = 300;

const NOTES_GUIDE = `*Pesan untuk Seller*

Gunakan kolom ini untuk mengirim informasi penting yang dibutuhkan seller untuk memproses pesananmu.

*Cocok Diisi Jika*
Diproses manual oleh seller
Membutuhkan data pembelian (email, nomor HP, dll)
Ada instruksi khusus yang perlu diperhatikan

*Contoh Isi Pesan*
Email: johndoe@gmail.com
No HP: 08123456789
Username: johndoe

_Ketik pesanmu di bawah ini (maks ${MAX_NOTES_LENGTH} karakter):_`;

/**
 * Re-send the order confirmation with updated notes.
 * Since WhatsApp can't edit messages, we send a new one.
 */
async function resendOrderConfirmation(ctx, notesCtx, buyerNotes) {
    const userId = ctx.from;
    const variantCode = notesCtx.variantValue;

    if (!variantCode) return;

    let variant = await productVariantRepository.findByCodeVariant(ctx, variantCode);
    const resellerOrder = !variant ? await resellerState.getResellerOrder(userId) : null;
    if (resellerOrder) {
        variant = await productVariantRepository.findPlatformVariant(resellerOrder.platformVariantCode);
    }
    if (!variant) return;

    const ownerId = ctx.repositoryContext?.ownerId;
    const isReseller = !!resellerOrder;

    const [effectivePrice, stockCount, product, voucherInfo, settings] = await Promise.all([
        ctx.pricingService.calculatePrice(variant, ownerId),
        isReseller ? stockRepository.countPlatformStock(variantCode) : stockRepository.countStock(ctx, variantCode),
        productRepository.findByCode(ctx, variant.code),
        voucherState.getAppliedVoucher(userId),
        settingsService.getSettings(ctx)
    ]);

    const price = isReseller
        ? require('../services/resellerService').calculateMarkup(effectivePrice, resellerOrder.markup_type, resellerOrder.markup_value)
        : effectivePrice;

    const orderQuantity = 1; // Default; the actual quantity context would need to be tracked
    const subtotal = orderQuantity * price;
    const resellerContext = resellerOrder ? { markupPerUnit: resellerOrder.markupPerUnit, quantity: orderQuantity } : null;
    const voucherDetails = await orderService.getVoucherDetails(userId, subtotal, resellerContext);
    const saldoEnabled = settings?.saldoEnabled !== false;
    const displayVariantName = resellerOrder?.displayName || variant.name;

    const data = messageFormatter.formatOrderConfirmation({
        productName: product?.name || '',
        variantName: displayVariantName,
        price: price,
        stockAvailable: stockCount,
        orderQuantity: orderQuantity,
        totalPrice: voucherDetails.totalPrice,
        voucherCode: voucherDetails.voucherCode,
        voucherDiscount: voucherDetails.voucherDiscount,
        subtotal: subtotal,
        isDiscountCapped: voucherDetails.isCapped,
        buyerNotes: buyerNotes
    });

    const { menuText, actionMap } = buildOrderMenuText({
        saldoEnabled,
        voucherCode: voucherDetails.voucherCode,
        buyerNotes
    });

    screenState.setScreen(userId, 'ORDER_CONFIRM', {
        variantCode,
        productCode: product?.code,
        actionMap,
        orderMessage: data
    });

    await ctx.reply(`${data}${menuText}`);
}

/**
 * Handle "catatan ISI PESAN" text command — add buyer notes.
 * @param {Object} ctx - WaCtx
 * @param {string} notesText - The notes content (after "catatan " prefix)
 * @param {string} variantCode - Current variant code from order context
 */
async function handleAddBuyerNotes(ctx, notesText, variantCode) {
    try {
        const userId = ctx.from;

        if (!notesText || notesText.trim().length === 0) {
            await ctx.reply(NOTES_GUIDE);
            await buyerNotesState.setUserNotesState(userId, {
                awaitingNotesInput: true,
                variantValue: variantCode,
                userId
            });
            return;
        }

        const text = notesText.trim();
        if (text.length > MAX_NOTES_LENGTH) {
            return ctx.reply(`*Pesan terlalu panjang* (${text.length}/${MAX_NOTES_LENGTH} karakter).\n_Silakan persingkat dan kirim ulang._`);
        }

        await buyerNotesState.setUserNotesState(userId, {
            notes: text,
            awaitingNotesInput: false,
            variantValue: variantCode,
            userId
        });

        const notesCtx = await buyerNotesState.getUserNotesState(userId);
        await resendOrderConfirmation(ctx, notesCtx, text);
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message
        });
        await ctx.reply('Terjadi kesalahan, coba lagi.');
    }
}

/**
 * Handle "editcatatan" text command — prompt user to enter new notes.
 */
async function handleEditBuyerNotes(ctx) {
    try {
        const userId = ctx.from;
        const existing = await buyerNotesState.getUserNotesState(userId);
        const existingNote = existing?.notes || null;

        const promptText = existingNote
            ? `*Ubah Pesan untuk Seller*\n\n*Pesan sebelumnya:*\n_"${existingNote}"_\n\n_Ketik pesan baru (maks ${MAX_NOTES_LENGTH} karakter):_`
            : NOTES_GUIDE;

        await ctx.reply(promptText);

        await buyerNotesState.updateUserNotesState(userId, {
            awaitingNotesInput: true
        });
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message
        });
        await ctx.reply('Terjadi kesalahan, coba lagi.');
    }
}

/**
 * Handle "hapuscatatan" text command — remove buyer notes.
 */
async function handleRemoveBuyerNotes(ctx) {
    try {
        const userId = ctx.from;
        const notesCtx = await buyerNotesState.getUserNotesState(userId);

        await buyerNotesState.clearBuyerNotes(userId);
        await ctx.reply('Pesan untuk seller dihapus.');

        if (notesCtx?.variantValue) {
            await resendOrderConfirmation(ctx, notesCtx, null);
        }
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message
        });
        await ctx.reply('Terjadi kesalahan, coba lagi.');
    }
}

/**
 * Handle cancel notes input — clear awaiting flag.
 */
async function handleCancelBuyerNotes(ctx) {
    try {
        const userId = ctx.from;
        await buyerNotesState.updateUserNotesState(userId, { awaitingNotesInput: false });
        await ctx.reply('Dibatalkan — tidak ada perubahan.');
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message
        });
    }
}

/**
 * Handle user's text input when awaiting notes.
 * Called from the text handler in the router.
 * @returns {Promise<boolean>} - true if message was handled as notes input
 */
async function handleBuyerNotesInput(ctx) {
    const userId = ctx.from;

    if (!await buyerNotesState.isAwaitingNotes(userId)) return false;

    const notesCtx = await buyerNotesState.getUserNotesState(userId);
    const text = ctx.message.trim();

    // Validate length
    if (text.length > MAX_NOTES_LENGTH) {
        await ctx.reply(`*Pesan terlalu panjang* (${text.length}/${MAX_NOTES_LENGTH} karakter).\n_Silakan persingkat dan kirim ulang._`);
        return true;
    }

    // Save note and clear awaiting flag
    await buyerNotesState.updateUserNotesState(userId, {
        notes: text,
        awaitingNotesInput: false
    });

    // Re-send order confirmation with updated notes
    if (notesCtx?.variantValue) {
        await resendOrderConfirmation(ctx, { ...notesCtx, userId }, text);
    } else {
        await ctx.reply(`Catatan disimpan: _"${text}"_`);
    }

    return true;
}

module.exports = {
    handleAddBuyerNotes,
    handleEditBuyerNotes,
    handleRemoveBuyerNotes,
    handleCancelBuyerNotes,
    handleBuyerNotesInput
};
