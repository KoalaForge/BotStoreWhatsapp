const WA_SUFFIX = '@s.whatsapp.net';

/**
 * Extract phone number from any WhatsApp ID format.
 * "6285155429967@s.whatsapp.net" → "6285155429967"
 * "6285155429967" → "6285155429967"
 */
function stripPhone(id) {
    if (!id) return '';
    return String(id).split('@')[0].trim();
}

/**
 * Ensure ID has @s.whatsapp.net suffix (for sock.sendMessage).
 * "6285155429967" → "6285155429967@s.whatsapp.net"
 * Already suffixed → returned as-is.
 */
function toJid(phone) {
    if (!phone) return '';
    const str = String(phone).trim();
    if (str.includes('@')) return str;
    return str + WA_SUFFIX;
}

/**
 * Build a MongoDB query that matches either phone-only or full JID.
 * Useful for findByWhatsappId where stored format is unknown.
 */
function jidQuery(field, id) {
    const phone = stripPhone(id);
    return { $or: [{ [field]: phone }, { [field]: phone + WA_SUFFIX }] };
}

module.exports = { stripPhone, toJid, jidQuery };
