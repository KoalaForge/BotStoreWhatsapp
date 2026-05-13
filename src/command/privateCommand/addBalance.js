const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const { formatMoney } = require('../../database/models/money');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID, jidQuery } = require('../../utils/jidHelper');

/**
 * Add balance to a user (WhatsApp version).
 * Usage: .addbalance <JID or phone> <amount> [reason]
 */
const addBalance = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.addbalance <JID atau nomor> <nominal> [alasan]`\n\n' +
                '*Contoh:*\n' +
                '`.addbalance 6281234567890 50000`\n' +
                '`.addbalance 6281234567890 100000 Bonus member aktif`\n\n' +
                '_JID: nomor WhatsApp atau JID lengkap_'
            );
        }

        const userId = normalizeJID(args[0]);
        const amount = parseInt(args[1]);
        const reason = args.slice(2).join(' ') || null;

        if (isNaN(amount) || amount <= 0) {
            return ctx.reply('*Nominal tidak valid!* Nominal harus berupa angka positif.');
        }

        if (amount > 100000000) {
            return ctx.reply('*Nominal terlalu besar!* Maksimal tambah saldo adalah Rp 100.000.000');
        }

        let userBalance = await botUserBalanceRepository.findByUserId(ctx, userId);

        if (!userBalance) {
            userBalance = await botUserBalanceRepository.create(ctx, {
                userId: userId,
                balance: amount,
                totalTopUp: amount,
                totalSpent: 0
            });

            await ctx.reply(
                `*Saldo berhasil ditambahkan*\n\n` +
                `*User:* \`${userId}\`\n` +
                `*Nominal:* ${formatMoney(amount)}\n` +
                `*Saldo Baru:* ${formatMoney(userBalance.balance)}\n\n` +
                `_User baru dibuat dengan saldo ${formatMoney(amount)}_`
            );
        } else {
            const oldBalance = userBalance.balance;
            await botUserBalanceRepository.updateOne(ctx,
                jidQuery('userId', userId),
                {
                    $inc: {
                        balance: amount,
                        totalTopUp: amount
                    }
                }
            );
            userBalance.balance += amount;

            await ctx.reply(
                `*Saldo berhasil ditambahkan*\n\n` +
                `*User:* \`${userId}\`\n` +
                `*Nominal Ditambahkan:* ${formatMoney(amount)}\n` +
                `*Saldo Sebelumnya:* ${formatMoney(oldBalance)}\n` +
                `*Saldo Baru:* ${formatMoney(userBalance.balance)}`
            );
        }

        // Notify user via WhatsApp if sock available
        try {
            if (ctx.sock) {
                const oldBal = (userBalance.balance - amount);
                const notifMsg =
                    `*Saldo Anda Telah Ditambahkan*\n\n` +
                    `*Nominal:* +${formatMoney(amount)}\n` +
                    `*Saldo Sebelumnya:* ${formatMoney(oldBal < 0 ? 0 : oldBal)}\n` +
                    `*Saldo Baru:* ${formatMoney(userBalance.balance)}\n` +
                    (reason ? `*Keterangan:* ${reason}\n` : '') +
                    `*Waktu:* ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm')} WIB\n\n` +
                    `_Terima kasih telah menggunakan layanan kami!_`;

                await ctx.sock.sendMessage(userId, { text: notifMsg });
            }
        } catch (notifyErr) {
            console.log(clc.yellow.bold("[ WARNING ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Cannot send balance notification to user ${userId}: ${notifyErr.message}`)}`);
        }

        console.log(clc.green.bold("[ SUCCESS ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Admin ${ctx.from} added ${amount} to user ${userId}'s balance`)}`);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/privateCommand/addBalance.js: ${err.message}`)}`);
    }
};

module.exports = addBalance;
