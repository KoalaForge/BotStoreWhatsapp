const adminRepository = require("../repositories/AdminRepository");
const repositoryContext = require("../services/repositoryContext");
const { stripPhone } = require("./jidHelper");

const isAdmin = async (id, ctx = null) => {
    // Accept phone JID (`628xxx@s.whatsapp.net`), LID (`xxx@lid`), or bare phone/lid user.
    // Baileys may route 1:1 messages via LID — pre-WhatsApp 2024 used phone only.
    // WHITELIST_ID env may contain mixed formats, comma-separated.
    const rawIncoming = String(id || '').trim();
    const incomingUser = stripPhone(rawIncoming);

    const whitelistEntries = (process.env.WHITELIST_ID || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    for (const entry of whitelistEntries) {
        if (entry === rawIncoming) return true;
        if (stripPhone(entry) === incomingUser) return true;
    }

    const context = ctx ? await repositoryContext.extractContext(ctx) : await repositoryContext.createContext(null, null);
    const admin = await adminRepository.findByWhatsappId(context, rawIncoming);

    return admin != null && admin != undefined;
}

module.exports = {
    isAdmin
}
