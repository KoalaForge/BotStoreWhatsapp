const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const { formatMoney } = require('../../database/models/money');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID } = require('../../utils/jidHelper');

/**
 * Check user balance (WhatsApp admin version).
 * Usage: .checkbalance <JID or phone>
 */
const checkBalance = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.checkbalance <JID atau nomor>`\n\n' +
                '*Contoh:*\n' +
                '`.checkbalance 6281234567890`'
            );
        }

        const userId = normalizeJID(args[0]);

        const userBalance = await botUserBalanceRepository.findByUserId(ctx, userId);

        if (!userBalance) {
            return ctx.reply(
                `*User tidak ditemukan!*\n\n` +
                `User dengan JID \`${userId}\` belum memiliki data saldo.`
            );
        }

        await ctx.reply(
            `*Informasi Saldo User*\n\n` +
            `*User:* \`${userId}\`\n` +
            `*Saldo Saat Ini:* ${formatMoney(userBalance.balance)}\n` +
            `*Total Top-Up:* ${formatMoney(userBalance.totalTopUp)}\n` +
            `*Total Pengeluaran:* ${formatMoney(userBalance.totalSpent)}\n` +
            `*Terakhir Update:* ${moment(userBalance.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB`
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/privateCommand/checkBalance.js: ${err.message}`)}`);
    }
};

module.exports = checkBalance;
