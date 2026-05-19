const adminRepository = require("../repositories/AdminRepository");
const repositoryContext = require("../services/repositoryContext");
const { stripPhone } = require("./jidHelper");

const isAdmin = async (id, ctx = null) => {
    // Accept phone JID (`628xxx@s.whatsapp.net`), LID (`xxx@lid`), device-suffixed
    // (`628xxx:N@s.whatsapp.net`), or bare phone/lid user. Baileys v7+ routes some
    // 1:1 messages via LID — phone form is exposed via remoteJidAlt/participantAlt.
    // Collect every identifier Baileys might give us, normalize to phone-only, and
    // match against env phones + DB admins. WHITELIST_ID env supports any format.
    const key = ctx?.rawMessage?.key || {};
    const candidates = [
        id,
        key.remoteJid,
        key.remoteJidAlt,      // baileys v7+
        key.participant,
        key.participantAlt,    // baileys v7+
        key.senderPn,          // baileys v6.7+ — phone JID of LID-routed sender
        key.senderLid,         // baileys v6.7+ — sender LID JID
        key.participantPn,     // baileys v6.7+ — group sender phone JID
        key.participantLid,    // baileys v6.7+ — group sender LID JID
    ]
        .filter(Boolean)
        .map(v => String(v).trim())
        .filter(Boolean);

    const incomingPhones = new Set();
    for (const c of candidates) {
        const p = stripPhone(c);
        if (p) incomingPhones.add(p);
    }

    const whitelistPhones = new Set();
    for (const raw of (process.env.WHITELIST_ID || '').split(',')) {
        const p = stripPhone(raw.trim());
        if (p) whitelistPhones.add(p);
    }

    for (const p of incomingPhones) {
        if (whitelistPhones.has(p)) return true;
    }

    const context = ctx
        ? await repositoryContext.extractContext(ctx)
        : await repositoryContext.createContext(null, null);

    for (const cand of candidates) {
        const admin = await adminRepository.findByWhatsappId(context, cand);
        if (admin) return true;
    }

    if (process.env.DEBUG_ADMIN === '1') {
        console.log(`[ADMIN] deny — incoming: ${[...incomingPhones].join(',') || '(empty)'} | env: ${[...whitelistPhones].join(',') || '(empty)'}`);
    }

    return false;
};

module.exports = {
    isAdmin
}
