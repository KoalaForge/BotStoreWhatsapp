const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const profitStockState = require('../../state/profitStockState');

/**
 * Set profit on stock - 2-step flow for WhatsApp
 *
 * Step 1: .setprofitstock <codeVariant> <profit>
 *         Bot asks for stock data
 * Step 2: User sends multi-line text
 *         Bot updates profit on matching stock items
 *
 * Uses profitStockState (in-memory Map) to persist state between messages,
 * since ctx.session does not survive across separate WhatsApp messages.
 */
const setProfitStock = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];
        const profit = args[1] ? parseInt(args[1]) : NaN;

        if (!codeVariant || isNaN(profit)) {
            return ctx.reply(
                '*Set Profit Stock*\n\n' +
                'Format:\n' +
                '`.setprofitstock <codeVariant> <profit>`\n\n' +
                'Contoh:\n' +
                '`.setprofitstock CANVA-1B 5000`\n\n' +
                '_Kirim command lalu balas dengan list stock yang ingin diset profit (satu per baris)._'
            );
        }

        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant produk tidak ditemukan.*');
        }

        profitStockState.startInput(ctx.from, codeVariant, profit);

        await ctx.reply(
            `*Kirim data stock yang ingin diset profit untuk \`${codeVariant}\`*\n` +
            `_Profit akan diset: Rp ${profit.toLocaleString('id-ID')}_\n\n` +
            'Kirim data stock sekarang (satu per baris):\n\n' +
            'Ketik `.cancel` untuk membatalkan.'
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in setProfitStock.js: ${err.message}`));
    }
};

/**
 * Handle profit stock data input (step 2).
 * Called from message router when user is in profit stock state.
 *
 * @param {Object} ctx - WhatsApp context
 * @returns {boolean} true if handled
 */
const handleProfitStockDataInput = async (ctx) => {
    try {
        const userId = ctx.from;
        const text = (ctx.message || '').trim();

        // Handle cancel
        if (text === '.cancel' || text === '.batal') {
            profitStockState.clear(userId);
            return ctx.reply('*Set profit stock dibatalkan.*');
        }

        // Skip if it looks like another command
        if (text.startsWith('.')) {
            return false;
        }

        const state = profitStockState.getAndClear(userId);
        if (!state) {
            return ctx.reply('*Sesi habis, silakan mulai dari awal dengan `.setprofitstock`*');
        }

        const stocks = text.split('\n').map(s => s.trim()).filter(s => s);

        if (stocks.length === 0) {
            profitStockState.startInput(userId, state.codeVariant, state.profit);
            return ctx.reply('*Data stock kosong.* Kirim ulang data stock (satu per baris):');
        }

        let count = 0;
        for (const stock of stocks) {
            await stockRepository.updateOne(ctx, { dataStock: stock }, { $set: { profit: state.profit } });
            count++;
        }

        await ctx.reply(
            `*Profit berhasil diset*\n\n` +
            `Variant: \`${state.codeVariant}\`\n` +
            `*Total stock diset profit:* ${count} item\n` +
            `*Profit per item:* Rp ${state.profit.toLocaleString('id-ID')}`
        );

        return true;
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan saat mengatur profit stock.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in handleProfitStockDataInput: ${err.message}`));
        profitStockState.clear(ctx.from);
        return true;
    }
};

module.exports = setProfitStock;
module.exports.handleProfitStockDataInput = handleProfitStockDataInput;
