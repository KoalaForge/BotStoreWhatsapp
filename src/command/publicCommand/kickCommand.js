const clc = require('cli-color');
const moment = require('moment-timezone');
const { isAdmin } = require('../../utils/checkRole');
const { toJid } = require('../../utils/jidHelper');
const {
    botIdentities,
    senderIdentities,
    participantIdentities,
    findParticipant,
    isParticipantAdmin,
    pickMentionJid,
    mentionPhone,
} = require('../../utils/groupParticipant');

const USAGE =
    '*Format Kick*\n\n' +
    '`.kick @user`     — tag user\n' +
    '`.kick 628xxxx`   — ketik nomor\n' +
    '`.kick`           — reply pesan user yang mau dikeluarkan';

function dlog(tag, msg) {
    console.log(
        clc.yellow.bold('[ DEBUG ]') +
        ` [${moment().format('HH:mm:ss')}]: ` +
        clc.blueBright(`[kick ${tag}] ${msg}`)
    );
}

function resolveTargetBundle(ctx) {
    const ci = ctx.rawMessage?.message?.extendedTextMessage?.contextInfo;

    if (ci?.stanzaId && ci?.participant) {
        return { bundle: participantIdentities({ id: ci.participant, jid: ci.participantAlt }), source: 'reply' };
    }

    if (Array.isArray(ci?.mentionedJid) && ci.mentionedJid.length > 0) {
        return { bundle: participantIdentities({ id: ci.mentionedJid[0] }), source: 'mention' };
    }

    const arg = (ctx.commandArgs || [])[0];
    if (arg) {
        const digits = String(arg).replace(/[^\d]/g, '');
        if (digits.length >= 8) {
            return { bundle: participantIdentities({ id: toJid(digits), jid: toJid(digits) }), source: 'phone' };
        }
    }

    return null;
}

function bundlesIntersect(a, b) {
    if (!a || !b) return false;
    for (const id of a.ids) if (b.ids.has(id)) return true;
    for (const ph of a.phones) if (b.phones.has(ph)) return true;
    return false;
}

async function kickCommand(ctx) {
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

    const senderEntry = findParticipant(meta, senderBundle);
    const senderIsBotAdmin = await isAdmin(ctx.from, ctx);
    if (!senderIsBotAdmin && !isParticipantAdmin(senderEntry)) {
        return ctx.reply('*Akses ditolak.* Hanya bot admin atau admin grup yang boleh.');
    }

    const botEntry = findParticipant(meta, botBundle);
    if (!isParticipantAdmin(botEntry)) {
        return ctx.reply('⚠️ *Bot bukan admin grup.* Jadikan bot admin dulu untuk pakai command ini.');
    }

    const target = resolveTargetBundle(ctx);
    if (!target) return ctx.reply(USAGE);

    if (bundlesIntersect(target.bundle, senderBundle)) {
        return ctx.reply('Tidak bisa kick diri sendiri.');
    }
    if (bundlesIntersect(target.bundle, botBundle)) {
        return ctx.reply('Tidak bisa kick bot.');
    }

    const targetEntry = findParticipant(meta, target.bundle);
    if (!targetEntry) {
        return ctx.reply('User tidak ada di grup.');
    }

    if (meta.owner) {
        const ownerBundle = participantIdentities({ id: meta.owner });
        const targetEntryBundle = participantIdentities(targetEntry);
        if (bundlesIntersect(ownerBundle, targetEntryBundle)) {
            return ctx.reply('Tidak bisa kick owner grup.');
        }
    }

    try {
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [targetEntry.id], 'remove');
    } catch (err) {
        dlog('kick-call', `failed: ${err?.message}`);
        return ctx.reply(`Gagal kick: ${err.message}`);
    }

    const mentionJid = pickMentionJid(targetEntry);
    const phone      = mentionPhone(targetEntry);
    return ctx.sock.sendMessage(
        ctx.chat,
        {
            text: `✅ *@${phone}* berhasil dikeluarkan dari grup.`,
            mentions: [mentionJid],
        },
        { quoted: ctx.rawMessage }
    );
}

module.exports = kickCommand;
