const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const delStockState = require('../../state/delStockState');

/**
 * Delete stock - 2-step flow for WhatsApp
 *
 * Step 1: .delstock <codeVariant>
 *         Bot asks for stock data to delete
 * Step 2: User sends multi-line text
 *         Bot deletes matching stock items
 *
 * Uses delStockState (in-memory Map) to persist state between messages,
 * since ctx.session does not survive across separate WhatsApp messages.
 */
const delStock = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];

        if (!codeVariant) {
            return ctx.reply(
                '*Hapus Stock*\n\n' +
                'Format:\n' +
                '`.delstock <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.delstock CANVA-1B`\n\n' +
                '_Kirim command lalu balas dengan list stock yang ingin dihapus (satu per baris)._'
            );
        }

        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant produk tidak ditemukan.*');
        }

        delStockState.startInput(ctx.from, codeVariant);

        await ctx.reply(
            `*Kirim data stock yang ingin dihapus untuk \`${codeVariant}\`*\n\n` +
            'Kirim data stock sekarang (satu per baris):\n\n' +
            'Ketik `.cancel` untuk membatalkan.'
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in delStock.js: ${err.message}`));
    }
};

/**
 * Handle stock deletion input (step 2).
 * Called from message router when user is in del stock state.
 *
 * @param {Object} ctx - WhatsApp context
 * @returns {boolean} true if handled
 */
const handleDelStockDataInput = async (ctx) => {
    try {
        const userId = ctx.from;
        const text = (ctx.message || '').trim();

        // Handle cancel
        if (text === '.cancel' || text === '.batal') {
            delStockState.clear(userId);
            return ctx.reply('*Hapus stock dibatalkan.*');
        }

        // Skip if it looks like another command
        if (text.startsWith('.')) {
            return false;
        }

        const state = delStockState.getAndClear(userId);
        if (!state) {
            return ctx.reply('*Sesi habis, silakan mulai dari awal dengan `.delstock`*');
        }

        const stocks = text.split('\n').map(s => s.trim()).filter(s => s);

        if (stocks.length === 0) {
            delStockState.startInput(userId, state.codeVariant);
            return ctx.reply('*Data stock kosong.* Kirim ulang data stock (satu per baris):');
        }

        let count = 0;
        for (const stock of stocks) {
            await stockRepository.deleteOne(ctx, { dataStock: stock });
            count++;
        }

        await ctx.reply(
            `*Stock berhasil dihapus*\n\n` +
            `Variant: \`${state.codeVariant}\`\n` +
            `*Total dihapus:* ${count} item`
        );

        return true;
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan saat menghapus stock.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in handleDelStockDataInput: ${err.message}`));
        delStockState.clear(ctx.from);
        return true;
    }
};

module.exports = delStock;
module.exports.handleDelStockDataInput = handleDelStockDataInput;
