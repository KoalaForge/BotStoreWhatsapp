const moment = require('moment-timezone');
const clc = require('cli-color');
const botUserRepository = require('../repositories/BotUserRepository');
const adminRepository = require('../repositories/AdminRepository');
const settingsService = require('./settingsService');
const modeService = require('./modeService');
const { getNotificationIds } = require('../utils/waNotifications');
const { isAdmin } = require('../utils/checkRole');
const { stripPhone, toJid } = require('../utils/jidHelper');
const { withRetry } = require('../utils/waRetry');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getCooldownStatus(user) {
    if (!user || user.whitelist_status !== 'rejected' || !user.whitelist_actioned_at) {
        return { active: false, remainingMs: 0 };
    }
    const elapsed = Date.now() - new Date(user.whitelist_actioned_at).getTime();
    if (elapsed >= COOLDOWN_MS) return { active: false, remainingMs: 0 };
    return { active: true, remainingMs: COOLDOWN_MS - elapsed };
}

function formatRemaining(ms) {
    const hrs = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    if (hrs > 0) return `${hrs} jam ${mins} menit`;
    return `${mins} menit`;
}

function buildAdminNotifMessage(ctx, user) {
    const phone = stripPhone(user.idWhatsapp || ctx.from);
    const name = user?.usernameTelegram || ctx?.fromUser?.first_name || '(tanpa nama)';
    const requestCount = user?.whitelist_request_count || 1;
    const ts = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
    const botLabel = (modeService.isMultiMode() && ctx?.state?.botId)
        ? `\nBot: ${ctx.state.botId}` : '';

    return `*Permohonan Akses Baru*

Nomor: ${phone}
Nama: ${name}${botLabel}
Permohonan ke: ${requestCount}
Waktu: ${ts} WIB

*Setuju:* .approvewhitelist ${phone}
*Tolak:* .rejectwhitelist ${phone}`;
}

async function dispatchAdminNotification(ctx, user) {
    const botId = ctx?.state?.botId ?? null;
    const ids = await getNotificationIds(botId);
    if (!ids || ids.length === 0) {
        console.log(clc.yellow('[ WHITELIST ]') + ` [${moment().format('HH:mm:ss')}] No admin JIDs configured`);
        return 0;
    }
    const text = buildAdminNotifMessage(ctx, user);
    let sent = 0;
    for (const jid of ids) {
        try {
            await withRetry(() => ctx.sock.sendMessage(jid, { text }));
            sent++;
        } catch (err) {
            console.log(clc.red('[ WHITELIST ]') + ` notif fail to ${jid}: ${err.message}`);
        }
    }
    return sent;
}

async function requestApproval(ctx, idWhatsapp, pushName = null) {
    const updated = await botUserRepository.markPendingWhatsapp(ctx, idWhatsapp, pushName);
    const userPayload = updated || { idWhatsapp, usernameTelegram: pushName, whitelist_request_count: 1 };
    await dispatchAdminNotification(ctx, userPayload);
    return updated;
}

async function approve(ctx, idWhatsapp, adminIdentifier) {
    const result = await botUserRepository.setWhitelistStatus(ctx, idWhatsapp, 'approved', adminIdentifier);
    return { changed: (result?.modifiedCount ?? 0) > 0 };
}

async function reject(ctx, idWhatsapp, adminIdentifier) {
    const result = await botUserRepository.setWhitelistStatus(ctx, idWhatsapp, 'rejected', adminIdentifier);
    return { changed: (result?.modifiedCount ?? 0) > 0 };
}

/**
 * Resolve every phone (no suffix) treated as admin in current scope:
 * env WHITELIST_ID (csv) + adminRepository.idWhatsapp values.
 */
async function getAdminPhones(ctx) {
    const phones = new Set();
    const env = process.env.WHITELIST_ID;
    if (env) {
        for (const raw of env.split(',')) {
            const p = stripPhone(raw);
            if (p) phones.add(p);
        }
    }
    try {
        const admins = await adminRepository.find(ctx, {});
        for (const a of admins) {
            const p = stripPhone(a.idWhatsapp);
            if (p) phones.add(p);
        }
    } catch (err) {
        console.log(clc.yellow('[ WHITELIST ]') + ` getAdminPhones fail: ${err.message}`);
    }
    return Array.from(phones);
}

async function bulkResetForBot(ctx) {
    const adminPhones = await getAdminPhones(ctx);
    await botUserRepository.bulkApproveWhatsappPhones(ctx, adminPhones);
    return await botUserRepository.bulkResetWhatsappToPending(ctx, adminPhones);
}

async function isWhitelistEnabled(ctx) {
    const settings = await settingsService.getSettings(ctx);
    return settings?.whitelistEnabled === true;
}

/**
 * Resolve current access state for a WhatsApp user. Used by middleware.
 * Identifier is the phone-only form (matches ctx.from output).
 * Possible reasons:
 *  - 'admin'           → allowed (skip gate)
 *  - 'mode_off'        → allowed (whitelist disabled in this scope)
 *  - 'approved'        → allowed
 *  - 'pending'         → blocked (waiting admin action)
 *  - 'cooldown'        → blocked (rejected, within 24h)
 *  - 'rejected_expired'→ trigger re-request (cooldown elapsed)
 *  - 'none'            → trigger first-time request
 */
async function checkUserAccess(ctx, idWhatsapp) {
    if (await isAdmin(idWhatsapp, ctx)) {
        return { allowed: true, reason: 'admin' };
    }
    if (!(await isWhitelistEnabled(ctx))) {
        return { allowed: true, reason: 'mode_off' };
    }
    const user = await botUserRepository.findByWhatsappId(ctx, idWhatsapp);
    const status = user?.whitelist_status || 'none';

    if (status === 'approved') return { allowed: true, reason: 'approved', user };
    if (status === 'pending') return { allowed: false, reason: 'pending', user };
    if (status === 'rejected') {
        const cd = getCooldownStatus(user);
        if (cd.active) return { allowed: false, reason: 'cooldown', user, cooldown: cd };
        return { allowed: false, reason: 'rejected_expired', user };
    }
    return { allowed: false, reason: 'none', user };
}

module.exports = {
    COOLDOWN_MS,
    getCooldownStatus,
    formatRemaining,
    buildAdminNotifMessage,
    dispatchAdminNotification,
    requestApproval,
    approve,
    reject,
    bulkResetForBot,
    isWhitelistEnabled,
    checkUserAccess,
    getAdminPhones,
};
