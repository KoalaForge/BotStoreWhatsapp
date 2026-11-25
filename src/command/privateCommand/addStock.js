const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const addStockState = require('../../state/addStockState');
const { UnitCostSource } = require('../../enums/UnitCostSource');
const { parseUnitCost, formatUnitCostSummary } = require('../../utils/unitCost');

const USAGE =
    '*Tambah Stock*\n\n' +
    'Format:\n' +
    '`.addstock <codeVariant> <modal>`\n\n' +
    'Contoh:\n' +
    '`.addstock CANVA-1B 5000`\n\n' +
    '_Modal = harga beli per unit, wajib diisi. Tulis angka bulat minimal 0, tanpa titik atau "k". Isi 0 untuk stok gratis._\n' +
    '_Profit dihitung otomatis: harga jual - modal._\n' +
    '_Data stock dikirim di pesan berikutnya._';

/**
 * Add stock - 2-step flow for WhatsApp
 *
 * Step 1: .addstock <codeVariant> <modal>
 *         Bot asks for stock data
 * Step 2: User sends multi-line text
 *         Bot processes each line as a stock item
 *
 * Uses addStockState (in-memory Map) to persist state between messages,
 * since ctx.session does not survive across separate WhatsApp messages.
 */
const addStock = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        // A new command replaces any pending one, so a rejected command can
        // never leave the next message going to the previous variant and cost.
        addStockState.clearState(ctx.from);

        const args = ctx.commandArgs || [];
        const [codeVariant, unitCostInput] = args;
        const unitCost = parseUnitCost(unitCostInput);

        if (args.length !== 2 || unitCost === null) {
            return ctx.reply(USAGE);
        }

        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant produk tidak ditemukan.*');
        }

        // Start awaiting stock data input
        addStockState.startStockInput(ctx.from, codeVariant, unitCost);

        await ctx.reply(
            `*Kirim data stock untuk \`${codeVariant}\`*\n` +
            `${formatUnitCostSummary(checkCode.price, unitCost)}\n\n` +
            'Kirim data stock sekarang (satu per baris):\n\n' +
            '_Contoh:_\n' +
            '```\nemail1@gmail.com|password1\nemail2@gmail.com|password2\nemail3@gmail.com|password3\n```\n\n' +
            'Ketik `.cancel` untuk membatalkan.'
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in addStock.js: ${err.message}`));
    }
};

/**
 * Handle stock data input (step 2).
 * Called from message router when user is in stock input state.
 *
 * @param {Object} ctx - WhatsApp context with text message
 * @returns {boolean} true if handled
 */
const handleStockDataInput = async (ctx) => {
    try {
        const userId = ctx.from;
        const text = (ctx.message || '').trim();

        // Handle cancel
        if (text === '.cancel' || text === '.batal') {
            addStockState.clearState(userId);
            return ctx.reply('*Input stock dibatalkan.*');
        }

        // Skip if it looks like another command
        if (text.startsWith('.')) {
            return false;
        }

        const state = addStockState.getAndClearState(userId);
        if (!state) {
            return ctx.reply('*Sesi habis, silakan mulai dari awal dengan `.addstock`*');
        }

        const { codeVariant, unitCost } = state;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        if (lines.length === 0) {
            // Re-start state so user can try again
            addStockState.startStockInput(userId, codeVariant, unitCost);
            return ctx.reply('*Data stock kosong.* Kirim ulang data stock (satu per baris):');
        }

        // Read again: the price may have changed since step 1
        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            await ctx.reply('*Code variant produk tidak ditemukan.*');
            return true;
        }

        const batchCode = await stockRepository.createStockBatch(ctx, codeVariant, {
            priceSnapshot: variant.price,
            unitCostPerUnit: unitCost,
            quantityAdded: lines.length
        });
        const profit = variant.price - unitCost;
        let count = 0;
        for (const line of lines) {
            await stockRepository.addStock(ctx, codeVariant, line, profit, null, {
                stockBatchId: batchCode,
                unitCost,
                unitCostSource: UnitCostSource.INPUT
            });
            count++;
        }

        await ctx.reply(
            `*Stock berhasil ditambahkan*\n\n` +
            `Variant: \`${codeVariant}\`\n` +
            `*Total ditambahkan:* ${count} item\n` +
            formatUnitCostSummary(variant.price, unitCost)
        );

        return true;
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan saat menambah stock.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in handleStockDataInput: ${err.message}`));
        addStockState.clearState(ctx.from);
        return true;
    }
};

module.exports = addStock;
module.exports.handleStockDataInput = handleStockDataInput;
