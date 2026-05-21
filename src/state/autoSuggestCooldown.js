const TTL_MS = 5 * 60 * 1000;
const cooldown = new Map();

function _key(groupJid, userJid, keyword) {
    return `${groupJid}::${userJid}::${String(keyword || '').toLowerCase()}`;
}

function canTrigger(groupJid, userJid, keyword) {
    if (!groupJid || !userJid || !keyword) return false;
    const k = _key(groupJid, userJid, keyword);
    const ts = cooldown.get(k);
    if (!ts) return true;
    if (Date.now() - ts > TTL_MS) {
        cooldown.delete(k);
        return true;
    }
    return false;
}

function markTriggered(groupJid, userJid, keyword) {
    if (!groupJid || !userJid || !keyword) return;
    cooldown.set(_key(groupJid, userJid, keyword), Date.now());
}

function clear() {
    cooldown.clear();
}

module.exports = { canTrigger, markTriggered, clear, TTL_MS };
