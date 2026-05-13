const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const { formatMoney } = require('../../database/models/money');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID, jidQuery } = require('../../utils/jidHelper');

/**
 * Subtract balance from a user (WhatsApp version).
 * Usage: .subtractbalance <JID or phone> <amount> [reason]
 */
const subtractBalance = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.subtractbalance <JID atau nomor> <nominal> [alasan]`\n\n' +
                '*Contoh:*\n' +
                '`.subtractbalance 6281234567890 50000`\n' +
                '`.subtractbalance 6281234567890 100000 Koreksi saldo`'
            );
        }

        const userId = normalizeJID(args[0]);
        const amount = parseInt(args[1]);
        const reason = args.slice(2).join(' ') || null;

        if (isNaN(amount) || amount <= 0) {
            return ctx.reply('*Nominal tidak valid!* Nominal harus berupa angka positif.');
        }

        let userBalance = await botUserBalanceRepository.findByUserId(ctx, userId);

        if (!userBalance) {
            return ctx.reply(
                `*User tidak ditemukan!*\n\n` +
                `User dengan JID \`${userId}\` belum memiliki data saldo.`
            );
        }

        if (userBalance.balance < amount) {
            return ctx.reply(
                `*Saldo tidak cukup!*\n\n` +
                `*User:* \`${userId}\`\n` +
                `*Saldo Saat Ini:* ${formatMoney(userBalance.balance)}\n` +
                `*Nominal yang Akan Dikurangi:* ${formatMoney(amount)}\n\n` +
                `_Saldo user tidak mencukupi untuk pengurangan ini._`
            );
        }

        const oldBalance = userBalance.balance;
        await botUserBalanceRepository.updateOne(ctx,
            jidQuery('userId', userId),
            { $inc: { balance: -amount } }
        );
        userBalance.balance -= amount;

        await ctx.reply(
            `*Saldo berhasil dikurangi*\n\n` +
            `*User:* \`${userId}\`\n` +
            `*Nominal Dikurangi:* ${formatMoney(amount)}\n` +
            `*Saldo Sebelumnya:* ${formatMoney(oldBalance)}\n` +
            `*Saldo Baru:* ${formatMoney(userBalance.balance)}`
        );

        // Notify user
        try {
            if (ctx.sock) {
                const notifMsg =
                    `*Saldo Anda Telah Dikurangi*\n\n` +
                    `*Nominal:* -${formatMoney(amount)}\n` +
                    `*Saldo Sebelumnya:* ${formatMoney(oldBalance)}\n` +
                    `*Saldo Baru:* ${formatMoney(userBalance.balance)}\n` +
                    (reason ? `*Keterangan:* ${reason}\n` : '') +
                    `*Waktu:* ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm')} WIB\n\n` +
                    `_Hubungi admin jika ada pertanyaan._`;

                await ctx.sock.sendMessage(userId, { text: notifMsg });
            }
        } catch (notifyErr) {
            console.log(clc.yellow.bold("[ WARNING ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Cannot send balance notification to user ${userId}: ${notifyErr.message}`)}`);
        }

        console.log(clc.green.bold("[ SUCCESS ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Admin ${ctx.from} subtracted ${amount} from user ${userId}'s balance`)}`);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/privateCommand/subtractBalance.js: ${err.message}`)}`);
    }
};

module.exports = subtractBalance;
