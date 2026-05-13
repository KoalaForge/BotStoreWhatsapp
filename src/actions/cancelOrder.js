const transactionService = require("../services/transactionService");
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');

async function cancelOrder(ctx) {
    try {

        const getTransaction = await transactionService.getPendingTransaction(ctx, ctx.from, 'product');

        if (getTransaction) {
            await transactionService.cancelTransaction(ctx, getTransaction);
        }

        await ctx.reply('Pesanan berhasil dibatalkan.');

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = cancelOrder;
