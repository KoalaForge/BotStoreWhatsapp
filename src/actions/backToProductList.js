const listProduct = require("../command/publicCommand/listProduct");
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');

async function backToProductList(ctx) {
    try {
        await listProduct(ctx, 1);
    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = backToProductList;
