'use strict';

const clc = require('cli-color');
const moment = require('moment-timezone');
const {
    botIdentities,
    participantIdentities,
    pickMentionJid,
    mentionPhone,
    stripDevice,
    phoneOf,
} = require('../utils/groupParticipant');
const { groupMetadataCached, invalidateGroupMetadata } = require('../utils/groupMetadataCache');

function log(level, msg) {
    const colors = { INFO: clc.green.bold, WARN: clc.yellow.bold, ERROR: clc.red.bold };
    const prefix = (colors[level] || clc.white)(`[ ${level} ]`);
    console.log(`${prefix} [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`[GroupGreeting] ${msg}`)}`);
}

function matchesBot(rawJid, botBundle) {
    const pBundle = participantIdentities({ id: rawJid });
    for (const id of pBundle.ids) if (botBundle.ids.has(id)) return true;
    for (const ph of pBundle.phones) if (botBundle.phones.has(ph)) return true;
    return false;
}

function bundleHasJid(bundle, jid) {
    const stripped = stripDevice(jid);
    if (!stripped) return false;
    if (bundle.ids.has(stripped)) return true;
    const ph = phoneOf(jid);
    return !!ph && bundle.phones.has(ph);
}

function findParticipantByJid(meta, jid) {
    if (!meta?.participants?.length || !jid) return null;
    for (const p of meta.participants) {
        if (bundleHasJid(participantIdentities(p), jid)) return p;
    }
    return null;
}

const buildWelcome = (mention, groupName) =>
`🔥 *HAI KAWAN!* ${mention} 🔥
━━━━━━━━━━━━━━━━━━
✨ *Welcome to ${groupName}* ✨

💫 *Quick Start:*
📋 \`.list\` → Lihat semua produk
📦 \`.stok\` → Cek stok terbaru
💰 \`.saldo\` → Cek saldo
💳 \`.topup <nominal>\` → Top-up saldo
🛒 \`.buy <kode> <qty>\` → Beli pakai QRIS
⚡ \`.buynow <kode> <qty>\` → Beli pakai saldo

_Let's shopping!_ 🛒`;

const buildGoodbye = (mention, groupName) =>
`😢 *GOODBYE KAWAN!* 👋
${mention} telah meninggalkan *${groupName}*

_Semoga kita berjumpa lagi! Until next time!_ 💫`;

async function handleParticipantUpdate(sock, update) {
    const { id: groupJid, participants, action } = update || {};
    if (!['add', 'remove'].includes(action)) return;
    if (!groupJid || !Array.isArray(participants) || participants.length === 0) return;

    const botBundle = botIdentities(sock);
    // Participant changed — drop stale cache so next read sees the new
    // membership. Then fetch fresh meta (will repopulate the cache).
    invalidateGroupMetadata(sock, groupJid);
    const meta = await groupMetadataCached(sock, groupJid).catch(() => null);
    const groupName = meta?.subject || 'grup ini';

    for (const pJid of participants) {
        if (matchesBot(pJid, botBundle)) continue;

        const pEntry    = findParticipantByJid(meta, pJid) || { id: pJid };
        const mentionJid = pickMentionJid(pEntry);
        const phone      = mentionPhone(pEntry);
        const mention    = `@${phone}`;
        const text = action === 'add'
            ? buildWelcome(mention, groupName)
            : buildGoodbye(mention, groupName);

        await sock.sendMessage(groupJid, { text, mentions: [mentionJid] }).catch((err) => {
            log('WARN', `send ${action} failed for ${pJid} in ${groupJid}: ${err.message}`);
        });
    }
}

module.exports = { handleParticipantUpdate };
