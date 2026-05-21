const TTL_MS = 5 * 60 * 1000;
const cooldown = new Map();

function _key(userJid, keyword) {
    return `${userJid}::${String(keyword || '').toLowerCase()}`;
}

function canTrigger(userJid, keyword) {
    if (!userJid || !keyword) return false;
    const k = _key(userJid, keyword);
    const ts = cooldown.get(k);
    if (!ts) return true;
    if (Date.now() - ts > TTL_MS) {
        cooldown.delete(k);
        return true;
    }
    return false;
}

function markTriggered(userJid, keyword) {
    if (!userJid || !keyword) return;
    cooldown.set(_key(userJid, keyword), Date.now());
}

function clear() {
    cooldown.clear();
}

module.exports = { canTrigger, markTriggered, clear, TTL_MS };
