const clc = require('cli-color');
const moment = require('moment-timezone');
const { isAdmin } = require('../../utils/checkRole');
const {
    botIdentities,
    senderIdentities,
    findParticipant,
    isParticipantAdmin,
    summarizeMeta,
} = require('../../utils/groupParticipant');
const { groupMetadataCached, invalidateGroupMetadata } = require('../../utils/groupMetadataCache');
const { getGroupIndex, isAdminInIndex } = require('../../utils/groupAdminIndex');

const TZ = 'Asia/Jakarta';
const OPEN_TEXT  = '*Kita sudah OPEN ya* silahkan ketik `.list` untuk melihat daftar menu yang tersedia 🔥';
const CLOSE_TEXT = '*Sorry we are closed* see you tomorrow 🫶🏻 _and thank you for today all_ 🙏🏻';

function dlog(tag, msg) {
    console.log(
        clc.yellow.bold('[ DEBUG ]') +
        ` [${moment().format('HH:mm:ss')}]: ` +
        clc.blueBright(`[open/close ${tag}] ${msg}`)
    );
}

async function setGroupAnnouncement(ctx, mode, statusText) {
    if (!ctx.isGroup) {
        return ctx.reply('Command ini hanya bisa digunakan di grup.');
    }

    const botBundle    = botIdentities(ctx.sock);
    const senderBundle = senderIdentities(ctx);

    // Admin checks via O(1) Set lookup on the derived index, not by iterating
    // the participants array (which is 1000-element in large groups).
    const index = await getGroupIndex(ctx.sock, ctx.chat, botBundle);
    if (!index) {
        return ctx.reply('Gagal ambil info grup. Coba lagi.');
    }

    const senderIsBotAdmin = await isAdmin(ctx.from, ctx);
    const senderIsGroupAdmin = isAdminInIndex(index, senderBundle);

    if (!senderIsBotAdmin && !senderIsGroupAdmin) {
        return ctx.reply('*Akses ditolak.* Hanya bot admin atau admin grup yang boleh.');
    }

    if (!index.botIsAdmin) {
        dlog('bot-admin-check',
            `botIds=[${[...botBundle.ids].join(',')}] botPhones=[${[...botBundle.phones].join(',')}] ` +
            `participants=${index.participantCount} admins=${index.adminIds.size}`
        );
        return ctx.reply('⚠️ *Bot bukan admin grup.* Jadikan bot admin dulu untuk pakai command ini.');
    }

    try {
        await ctx.sock.groupSettingUpdate(ctx.chat, mode);
        invalidateGroupMetadata(ctx.sock, ctx.chat);
    } catch (err) {
        return ctx.reply(`Gagal ubah pengaturan grup: ${err.message}`);
    }

    const now = moment().tz(TZ);
    const body =
        `${statusText}\n\n` +
        `> 📆 *DATE* : ${now.format('dddd MMMM D, YYYY')}\n` +
        `> ⌚ *TIME* : ${now.format('HH:mm:ss')}`;
    return ctx.reply(body);
}

const openGroupCommand  = (ctx) => setGroupAnnouncement(ctx, 'not_announcement', OPEN_TEXT);
const closeGroupCommand = (ctx) => setGroupAnnouncement(ctx, 'announcement',     CLOSE_TEXT);

module.exports = { openGroupCommand, closeGroupCommand };
