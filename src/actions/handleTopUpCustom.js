const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../utils/errorSanitizer');

async function handleTopUpCustom(ctx) {
    try {
        await ctx.reply("*Masukkan Nominal Top-up*\n\nMinimal Rp 5.000\n_Contoh: 15000_");

        // Set session state to await custom nominal input
        if (!ctx.session) {
            ctx.session = {};
        }
        ctx.session.waitingForTopUpNominal = true;

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        ctx.reply(`*Terjadi kesalahan:* ${sanitizeErrorMessage(err)}\n_Silakan coba lagi atau hubungi admin jika masalah berlanjut._`);
    }
}

module.exports = handleTopUpCustom;
