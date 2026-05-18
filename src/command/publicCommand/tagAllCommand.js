const { isAdmin } = require('../../utils/checkRole');
const {
    botIdentities,
    senderIdentities,
    participantIdentities,
    findParticipant,
    isParticipantAdmin,
    pickMentionJid,
    mentionPhone,
} = require('../../utils/groupParticipant');
const { groupMetadataCached } = require('../../utils/groupMetadataCache');

const MAX_MENTIONS = 1024;

const USAGE =
    '*Format Tag-All*\n\n' +
    '`.tagall <pesan>`   — mention semua member terlihat di body\n' +
    '`.hidetag <pesan>`  — mention tersembunyi (silent ping)\n\n' +
    '_Pesan boleh multi-line._';

function extractBody(ctx, aliases) {
    const raw = (ctx.message || '').trimStart();
    const lower = raw.toLowerCase();
    for (const a of aliases) {
        const prefix = `.${a.toLowerCase()}`;
        if (lower.startsWith(prefix)) {
            return raw.slice(prefix.length).replace(/^\s+/, '');
        }
    }
    return '';
}

async function commonGate(ctx) {
    if (!ctx.isGroup) {
        await ctx.reply('Command ini hanya bisa digunakan di grup.');
        return null;
    }

    const meta = await groupMetadataCached(ctx.sock, ctx.chat).catch(() => null);
    if (!meta) {
        await ctx.reply('Gagal ambil info grup. Coba lagi.');
        return null;
    }

    const botBundle    = botIdentities(ctx.sock);
    const senderBundle = senderIdentities(ctx);

    const senderEntry = findParticipant(meta, senderBundle);
    const senderIsBotAdmin = await isAdmin(ctx.from, ctx);
    if (!senderIsBotAdmin && !isParticipantAdmin(senderEntry)) {
        await ctx.reply('*Akses ditolak.* Hanya bot admin atau admin grup yang boleh.');
        return null;
    }

    return { meta, botBundle };
}

function buildMentionTargets(meta, botBundle) {
    const targets = [];
    for (const p of meta.participants || []) {
        const pBundle = participantIdentities(p);
        let isBot = false;
        for (const id of pBundle.ids) if (botBundle.ids.has(id)) { isBot = true; break; }
        if (!isBot) {
            for (const ph of pBundle.phones) if (botBundle.phones.has(ph)) { isBot = true; break; }
        }
        if (!isBot) targets.push(p);
    }
    return targets;
}

async function tagAllCommand(ctx) {
    const gate = await commonGate(ctx);
    if (!gate) return;

    const body = extractBody(ctx, ['tagall', 'tag']);
    if (!body) return ctx.reply(USAGE);

    const targets = buildMentionTargets(gate.meta, gate.botBundle);
    const capped = targets.slice(0, MAX_MENTIONS);
    const overflow = targets.length - capped.length;

    const mentions = capped.map(pickMentionJid);
    const bullets  = capped.map(p => `• @${mentionPhone(p)}`).join('\n');

    let text =
        `${body}\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `👥 *Tagged Members:*\n` +
        bullets;

    if (overflow > 0) {
        text += `\n\n_(+${overflow} member lainnya tidak ditag karena limit WhatsApp)_`;
    }

    return ctx.sock.sendMessage(ctx.chat, { text, mentions });
}

async function hideTagCommand(ctx) {
    const gate = await commonGate(ctx);
    if (!gate) return;

    const body = extractBody(ctx, ['hidetag', 'htag']);
    if (!body) return ctx.reply(USAGE);

    const targets = buildMentionTargets(gate.meta, gate.botBundle);
    const capped = targets.slice(0, MAX_MENTIONS);
    const mentions = capped.map(pickMentionJid);

    return ctx.sock.sendMessage(ctx.chat, { text: body, mentions });
}

module.exports = { tagAllCommand, hideTagCommand };
