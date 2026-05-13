const botUserRepository = require('../../repositories/BotUserRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID } = require('../../utils/jidHelper');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Ban a user (WhatsApp version).
 * Usage: .banned <whatsappJID or phone> [reason]
 */
const bannedUser = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.banned <JID atau nomor> <alasan>`\n\n' +
                '*Contoh:*\n' +
                '`.banned 6281234567890 spam berlebihan`'
            );
        }

        const jid = normalizeJID(args[0]);
        const banReason = args.slice(1).join(' ');

        const user = await botUserRepository.findByWhatsappId(ctx, jid);

        if (!user) {
            return ctx.reply('User dengan JID tersebut tidak ditemukan dalam database.');
        }

        if (user.is_banned) {
            return ctx.reply('User tersebut sudah dalam status banned.');
        }

        await botUserRepository.updateOne(
            ctx,
            { idWhatsapp: user.idWhatsapp },
            {
                is_banned: true,
                ban_reason: banReason,
                banned_at: new Date(),
                banned_by: ctx.from
            }
        );

        const adminPhone = ctx.from;

        await ctx.reply(
            `*User berhasil diblokir*\n\n` +
            `*User JID:* ${jid}\n` +
            `*Alasan:* ${banReason}\n` +
            `*Diblokir oleh:* ${adminPhone}\n` +
            `*Waktu:* ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB`
        );

        console.log(clc.yellow.bold("[ BAN ]") + ` [${moment().tz('Asia/Jakarta').format('HH:mm:ss')}]:` + clc.blueBright(` User ${jid} has been banned by admin ${ctx.from}. Reason: ${banReason}`));

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().tz('Asia/Jakarta').format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/bannedUser.js  ${err.message}`));
    }
};

module.exports = bannedUser;
