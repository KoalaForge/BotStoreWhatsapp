const botUserRepository = require('../../repositories/BotUserRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID } = require('../../utils/jidHelper');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Unban a user (WhatsApp version).
 * Usage: .unbanned <whatsappJID or phone>
 */
const unbannedUser = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.unbanned <JID atau nomor>`\n\n' +
                '*Contoh:*\n' +
                '`.unbanned 6281234567890`'
            );
        }

        const jid = normalizeJID(args[0]);

        const user = await botUserRepository.findByWhatsappId(ctx, jid);

        if (!user) {
            return ctx.reply('User dengan JID tersebut tidak ditemukan dalam database.');
        }

        if (!user.is_banned) {
            return ctx.reply('User tersebut tidak dalam status banned.');
        }

        await botUserRepository.updateOne(
            ctx,
            { idWhatsapp: user.idWhatsapp },
            {
                is_banned: false,
                ban_reason: null,
                banned_at: null,
                banned_by: null
            }
        );

        const adminPhone = ctx.from;

        await ctx.reply(
            `*Blokir user berhasil dibuka*\n\n` +
            `*User JID:* ${jid}\n` +
            `*Dibuka oleh:* ${adminPhone}\n` +
            `*Waktu:* ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB\n\n` +
            `_User sekarang dapat menggunakan bot kembali._`
        );

        console.log(clc.green.bold("[ UNBAN ]") + ` [${moment().tz('Asia/Jakarta').format('HH:mm:ss')}]:` + clc.blueBright(` User ${jid} has been unbanned by admin ${ctx.from}`));

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().tz('Asia/Jakarta').format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/unbannedUser.js  ${err.message}`));
    }
};

module.exports = unbannedUser;
