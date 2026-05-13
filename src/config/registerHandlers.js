const actions = require('../actions');
const { prepareOrder } = require('../actions/showPesanan');
const command = require('../command/exportCommand');
const voucherState = require('../state/voucherState');
const snkState = require('../state/snkState');
const addStockState = require('../state/addStockState');
const delStockState = require('../state/delStockState');
const profitStockState = require('../state/profitStockState');
const buyerNotesState = require('../state/buyerNotesState');
const screenState = require('../state/screenState');
const transactionService = require('../services/transactionService');

// Top-up preset nominals mapped to number keys 1-4
const TOPUP_PRESETS = [10000, 25000, 50000, 100000];

/**
 * Registers all hears and action handlers on the WhatsApp message router.
 * Uses screen-based text routing instead of button callbacks.
 *
 * @param {MessageRouter} router - The WhatsApp message router
 */
function registerHandlers(router) {
    // ============================================
    // STATE-BASED INPUT INTERCEPTORS (MUST BE FIRST)
    // ============================================

    router.use(async (ctx, next) => {
        if (ctx.isCallback) return next();

        const text = ctx.message?.trim();
        if (!text) return next();

        const userId = ctx.from;

        // SNK state check (sync, O(1))
        if (snkState.isAwaitingTerms(userId) || snkState.isAwaitingWarranty(userId)) {
            await command.handleSnkInput(ctx);
            return;
        }

        // AddStock state check (sync, O(1))
        if (addStockState.isAwaitingStockData(userId)) {
            const handled = await command.handleStockDataInput(ctx);
            if (handled) return;
        }

        // DelStock state check (sync, O(1))
        if (delStockState.isAwaiting(userId)) {
            const handled = await command.handleDelStockDataInput(ctx);
            if (handled) return;
        }

        // SetProfitStock state check (sync, O(1))
        if (profitStockState.isAwaiting(userId)) {
            const handled = await command.handleProfitStockDataInput(ctx);
            if (handled) return;
        }

        // Voucher code input check (async, Redis/Mongo)
        if (await voucherState.isAwaitingVoucherCode(userId)) {
            const handled = await actions.voucherActions.handleVoucherCodeInput(ctx, text);
            if (handled) return;
        }

        // Buyer notes input check
        if (await actions.handleBuyerNotes.handleBuyerNotesInput(ctx)) return;

        return next();
    });

    // ============================================
    // GLOBAL KEYWORDS + SCREEN-BASED ROUTING
    // ============================================

    router.use(async (ctx, next) => {
        if (ctx.isCallback) return next();

        const text = ctx.message?.trim();
        if (!text) return next();

        const lower = text.toLowerCase();
        const userId = ctx.from;

        // --- Global keyword: cancel ---
        if (lower === 'batal') {
            const pending = await transactionService.getPendingTransaction(ctx, userId);
            if (pending) {
                if (pending.transaction_type === 'topup') {
                    await actions.cancelTopUp(ctx);
                } else {
                    await actions.cancelOrder(ctx);
                }
            } else {
                await ctx.reply('Tidak ada transaksi untuk dibatalkan.');
            }
            return;
        }

        // --- Global keyword: menu ---
        if (lower === 'menu') {
            screenState.clear(userId);
            await actions.backToProductList(ctx);
            return;
        }

        // --- Global keyword: back (0 or kembali) ---
        if (lower === '0' || lower === 'kembali') {
            await handleBack(ctx, userId);
            return;
        }

        // --- Number input: route based on current screen ---
        if (/^\d+$/.test(text)) {
            const handled = await handleNumberInput(ctx, userId, parseInt(text, 10), text);
            if (handled) return;
        }

        // --- Text command routing (all handled here for reliability) ---
        let match;

        // Quick-buy: buy <code> [qty] → direct QRIS
        if ((match = text.match(/^buy\s+(\S+)(?:\s+(\d+))?$/i))) {
            const qty = match[2] ? parseInt(match[2], 10) : 1;
            if (qty < 1) {
                await ctx.reply('Jumlah minimal 1.');
                return;
            }
            ctx.match = [null, match[1]];
            const result = await prepareOrder(ctx, qty);
            if (result) await actions.payWithQris(ctx);
            return;
        }

        // Quick-buy: buynow <code> [qty] → direct saldo
        if ((match = text.match(/^buynow\s+(\S+)(?:\s+(\d+))?$/i))) {
            const qty = match[2] ? parseInt(match[2], 10) : 1;
            if (qty < 1) {
                await ctx.reply('Jumlah minimal 1.');
                return;
            }
            ctx.match = [null, match[1]];
            const result = await prepareOrder(ctx, qty);
            if (result) await actions.handlePayWithBalance(ctx);
            return;
        }

        // Transaction history (longest match first)
        if (/^riwayat\s+pembelian\s+semua$/i.test(lower)) {
            await command.transactionHistory.exportPurchaseHistory(ctx);
            return;
        }
        if (/^riwayat\s+pembelian$/i.test(lower)) {
            await command.transactionHistory.showPurchaseHistory(ctx);
            return;
        }
        if (/^riwayat\s+deposit\s+semua$/i.test(lower)) {
            await command.transactionHistory.exportDepositHistory(ctx);
            return;
        }
        if (/^riwayat\s+deposit$/i.test(lower)) {
            await command.transactionHistory.showDepositHistory(ctx);
            return;
        }
        if (/^riwayat$/i.test(lower)) {
            await command.transactionHistory.showTransactionHistory(ctx);
            return;
        }

        // Text shortcuts
        if (/^list\s*produk$/i.test(lower)) { await command.listProduct(ctx); return; }
        if (/^cara\s*order$/i.test(lower)) { await command.helpCommand(ctx); return; }
        if (/^saldo$/i.test(lower)) { await command.saldoCommand(ctx); return; }

        return next();
    });

    // Greeting: "halo", "hai", etc. → product list
    router.start(command.listProduct);

    // Fallback: unrecognized text → product list
    router.onText(async (ctx) => {
        await command.listProduct(ctx);
    });
}

/**
 * Handle "back" navigation based on current screen.
 */
async function handleBack(ctx, userId) {
    const state = screenState.getScreen(userId);
    const screen = state?.screen;

    switch (screen) {
        case 'VARIANT_SELECT':
            screenState.clear(userId);
            await actions.backToProductList(ctx);
            break;

        case 'ORDER_CONFIRM':
            if (state.productCode) {
                ctx.match = [null, state.productCode];
                screenState.setScreen(userId, 'VARIANT_SELECT', { productCode: state.productCode });
                await actions.handleProductVariantRefresh(ctx);
            } else {
                screenState.clear(userId);
                await actions.backToProductList(ctx);
            }
            break;

        case 'QUANTITY_INPUT':
            if (state.variantCode) {
                ctx.match = [null, state.variantCode];
                screenState.setScreen(userId, 'ORDER_CONFIRM', {
                    variantCode: state.variantCode,
                    productCode: state.productCode
                });
                await actions.showPesanan(ctx);
            } else {
                screenState.clear(userId);
                await actions.backToProductList(ctx);
            }
            break;

        case 'PAY_BALANCE_CONFIRM':
            if (state.variantCode) {
                ctx.match = [null, state.variantCode];
                screenState.setScreen(userId, 'ORDER_CONFIRM', {
                    variantCode: state.variantCode,
                    productCode: state.productCode
                });
                await actions.showPesanan(ctx);
            } else {
                screenState.clear(userId);
                await actions.backToProductList(ctx);
            }
            break;

        case 'SALDO_TOPUP':
            screenState.clear(userId);
            await actions.backToProductList(ctx);
            break;

        case 'CUSTOM_TOPUP_INPUT':
            // Back to saldo menu
            await actions.handleSaldoButton(ctx);
            break;

        default:
            // No screen or PRODUCT_LIST — already at root
            await actions.backToProductList(ctx);
            break;
    }
}

/**
 * Handle numeric input routed by current screen.
 * Returns true if the input was handled, false to pass to next middleware.
 */
async function handleNumberInput(ctx, userId, num, rawText) {
    const state = screenState.getScreen(userId);
    const screen = state?.screen;

    switch (screen) {
        case 'VARIANT_SELECT':
            return await handleVariantSelect(ctx, userId, num, state);

        case 'ORDER_CONFIRM':
            return await handleOrderConfirm(ctx, userId, num, state);

        case 'QUANTITY_INPUT':
            return await handleQuantityInput(ctx, userId, num, state);

        case 'PAY_BALANCE_CONFIRM':
            return await handlePayBalanceConfirm(ctx, userId, num, state);

        case 'SALDO_TOPUP':
            return await handleSaldoTopup(ctx, userId, num, state);

        case 'CUSTOM_TOPUP_INPUT':
            return await handleCustomTopupInput(ctx, userId, num);

        default:
            // No screen or PRODUCT_LIST — number = product selection
            await actions.handleProductList(ctx);
            return true;
    }
}

/**
 * VARIANT_SELECT: number = variant position in the list.
 */
async function handleVariantSelect(ctx, userId, num, state) {
    const items = state.variantItems;
    if (!items || !Array.isArray(items) || items.length === 0) {
        await ctx.reply('Daftar variasi tidak tersedia. Ketik `menu` untuk kembali.');
        return true;
    }

    const index = num - 1;
    if (index < 0 || index >= items.length) {
        await ctx.reply(`Pilih nomor 1-${items.length}.`);
        return true;
    }

    const variantCode = items[index].code;
    ctx.match = [String(num), variantCode];

    screenState.setScreen(userId, 'ORDER_CONFIRM', {
        variantCode,
        productCode: state.productCode
    });

    await actions.showPesanan(ctx);
    return true;
}

/**
 * ORDER_CONFIRM: numbered action menu.
 * 1=payQris, 2=payBalance, 3=quantityInput, 4=voucher, 5=buyerNotes, 0=back
 */
async function handleOrderConfirm(ctx, userId, num, state) {
    const variantCode = state.variantCode;

    // Inject stored order message so payment handlers can parse order details
    if (state.orderMessage) {
        if (!ctx.session) ctx.session = {};
        ctx.session.lastOrderMessage = state.orderMessage;
    }

    switch (num) {
        case 1:
            // Pay with QRIS
            await actions.payWithQris(ctx);
            return true;

        case 2:
            // Pay with balance
            screenState.setScreen(userId, 'PAY_BALANCE_CONFIRM', {
                variantCode,
                productCode: state.productCode,
                orderMessage: state.orderMessage
            });
            await actions.handlePayWithBalance(ctx);
            return true;

        case 3:
            // Enter quantity
            screenState.setScreen(userId, 'QUANTITY_INPUT', {
                variantCode,
                productCode: state.productCode
            });
            await ctx.reply('*Masukkan Jumlah Pesanan*\n\nKetik angka jumlah yang diinginkan.\n_Contoh: 3_\n\nKetik `0` untuk kembali.');
            return true;

        case 4: {
            // Voucher: toggle apply/remove based on current state
            const vState = await voucherState.getUserVoucherState(userId);
            if (vState?.voucherCode) {
                // handleRemoveVoucher auto re-renders order screen via showPesanan
                await actions.voucherActions.handleRemoveVoucher(ctx);
            } else {
                const orderAmount = vState?.orderAmount || 1;
                await actions.voucherActions.handleApplyVoucherRequest(ctx, variantCode, orderAmount);
            }
            return true;
        }

        case 5:
            // Buyer notes
            if (variantCode) {
                await actions.handleBuyerNotes.handleAddBuyerNotes(ctx, null, variantCode);
            } else {
                await ctx.reply('Pilih produk terlebih dahulu.');
            }
            return true;

        default:
            await ctx.reply('Pilih 1-5, atau ketik `0` untuk kembali.');
            return true;
    }
}

/**
 * QUANTITY_INPUT: number = desired quantity.
 */
async function handleQuantityInput(ctx, userId, num, state) {
    const variantCode = state.variantCode;
    if (!variantCode) {
        await ctx.reply('Variasi tidak ditemukan. Ketik `menu` untuk kembali.');
        return true;
    }

    if (num < 1) {
        await ctx.reply('Jumlah minimal 1.');
        return true;
    }

    // After quantity change, go back to order confirm screen
    screenState.setScreen(userId, 'ORDER_CONFIRM', {
        variantCode,
        productCode: state.productCode
    });

    await actions.plusMinesStockProduct(ctx, variantCode, num);
    return true;
}

/**
 * PAY_BALANCE_CONFIRM: 1=confirm, 2=cancel (back to order).
 */
async function handlePayBalanceConfirm(ctx, userId, num, state) {
    // Inject stored order message so payment handlers can parse order details
    if (state.orderMessage) {
        if (!ctx.session) ctx.session = {};
        ctx.session.lastOrderMessage = state.orderMessage;
    }

    switch (num) {
        case 1:
            await actions.confirmPayBalance(ctx);
            return true;

        case 2:
            // Back to order confirmation
            if (state.variantCode) {
                ctx.match = [null, state.variantCode];
                screenState.setScreen(userId, 'ORDER_CONFIRM', {
                    variantCode: state.variantCode,
                    productCode: state.productCode
                });
                await actions.showPesanan(ctx);
            } else {
                screenState.clear(userId);
                await actions.backToProductList(ctx);
            }
            return true;

        default:
            await ctx.reply('Ketik `1` untuk konfirmasi, `2` untuk batal.');
            return true;
    }
}

/**
 * SALDO_TOPUP: 1-4=preset, 5=custom prompt, >5000=direct nominal, 0=back.
 */
async function handleSaldoTopup(ctx, userId, num, state) {
    if (num >= 1 && num <= 4) {
        const nominal = TOPUP_PRESETS[num - 1];
        ctx.callbackData = `topup-${nominal}`;
        await actions.handleTopUpNominal(ctx);
        return true;
    }

    if (num === 5) {
        screenState.setScreen(userId, 'CUSTOM_TOPUP_INPUT', {});
        await ctx.reply('*Masukkan Nominal Top-up*\n\nMinimal Rp 5.000\n_Contoh: 15000_\n\nKetik `0` untuk kembali.');
        return true;
    }

    // Direct nominal input (e.g. user types 50000)
    if (num >= 5000) {
        return await handleCustomTopupInput(ctx, userId, num);
    }

    await ctx.reply('Pilih 1-5, atau ketik nominal langsung (min. 5000).\nKetik `0` untuk kembali.');
    return true;
}

/**
 * CUSTOM_TOPUP_INPUT: user types a nominal amount.
 */
async function handleCustomTopupInput(ctx, userId, num) {
    if (num < 5000) {
        await ctx.reply('*Nominal tidak valid.* Minimal top-up Rp 5.000.\nKetik nominal atau `0` untuk kembali.');
        return true;
    }
    if (num > 10000000) {
        await ctx.reply('*Nominal terlalu besar.* Maksimal top-up Rp 10.000.000.\nKetik nominal atau `0` untuk kembali.');
        return true;
    }

    // Process as custom top-up
    ctx.callbackData = `topup-${num}`;
    await actions.handleTopUpNominal(ctx);
    return true;
}

module.exports = registerHandlers;
