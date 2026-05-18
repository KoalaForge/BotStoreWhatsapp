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

    const meta = await ctx.sock.groupMetadata(ctx.chat).catch((err) => {
        dlog('meta', `fetch failed: ${err?.message}`);
        return null;
    });
    if (!meta) {
        return ctx.reply('Gagal ambil info grup. Coba lagi.');
    }

    const botBundle    = botIdentities(ctx.sock);
    const senderBundle = senderIdentities(ctx);

    const botEntry    = findParticipant(meta, botBundle);
    const senderEntry = findParticipant(meta, senderBundle);

    const senderIsBotAdmin = await isAdmin(ctx.from, ctx);
    const senderIsGroupAdmin = isParticipantAdmin(senderEntry);

    if (!senderIsBotAdmin && !senderIsGroupAdmin) {
        return ctx.reply('*Akses ditolak.* Hanya bot admin atau admin grup yang boleh.');
    }

    if (!isParticipantAdmin(botEntry)) {
        dlog('bot-admin-check',
            `botIds=[${[...botBundle.ids].join(',')}] botPhones=[${[...botBundle.phones].join(',')}] ` +
            `botEntry=${botEntry ? JSON.stringify({ id: botEntry.id, lid: botEntry.lid, jid: botEntry.jid, admin: botEntry.admin, isAdmin: botEntry.isAdmin, isSuperAdmin: botEntry.isSuperAdmin }) : 'NOT_FOUND'} | ${summarizeMeta(meta)}`
        );
        return ctx.reply('⚠️ *Bot bukan admin grup.* Jadikan bot admin dulu untuk pakai command ini.');
    }

    try {
        await ctx.sock.groupSettingUpdate(ctx.chat, mode);
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
