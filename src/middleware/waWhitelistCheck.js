const moment = require('moment-timezone');
const clc = require('cli-color');
const whitelistService = require('../services/whitelistService');

// In-memory cache of "allowed" decisions per (botId, phone). Short TTL so admin
// approvals propagate quickly. Only positive decisions cached; blocked users
// always re-checked so flips through immediately.
const _accessCache = new Map();
const ACCESS_CACHE_TTL_MS = 60_000;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _accessCache.entries()) {
        if (now - entry.ts > ACCESS_CACHE_TTL_MS) _accessCache.delete(key);
    }
}, ACCESS_CACHE_TTL_MS).unref();

function _cacheKey(ctx, phone) {
    const botId = ctx?.state?.botId ?? 'single';
    return `${botId}:${phone}`;
}

/**
 * Whitelist gate for WhatsApp. Runs in MessageRouter middleware chain after
 * waBanCheck. Skips for:
 *  - missing ctx.from
 *  - group messages (whitelist only meaningful for DM)
 *  - admins
 *  - whitelist disabled in this scope
 *  - already-approved users (cached)
 */
const waWhitelistCheckMiddleware = async (ctx, next) => {
    try {
        const phone = ctx.from;
        if (!phone) return next();

        // Skip groups — whitelist mode targets DM customers
        const chatJid = ctx.chat || '';
        if (chatJid.endsWith('@g.us')) return next();

        const key = _cacheKey(ctx, phone);
        const cached = _accessCache.get(key);
        if (cached && cached.allowed && (Date.now() - cached.ts) < ACCESS_CACHE_TTL_MS) {
            return next();
        }

        const access = await whitelistService.checkUserAccess(ctx, phone);

        if (access.allowed) {
            _accessCache.set(key, { allowed: true, ts: Date.now() });
            return next();
        }

        if (access.reason === 'pending') {
            await ctx.reply('*Permohonan menunggu approval admin*\n\nMohon ditunggu, admin akan segera menindaklanjuti permohonan Anda.');
            return;
        }

        if (access.reason === 'cooldown') {
            const remaining = whitelistService.formatRemaining(access.cooldown.remainingMs);
            await ctx.reply(`*Akses Ditolak*\n\nPermohonan Anda sebelumnya ditolak.\nSilakan ajukan kembali dalam *${remaining}*.`);
            return;
        }

        if (access.reason === 'none' || access.reason === 'rejected_expired') {
            const pushName = ctx?.fromUser?.first_name || null;
            await whitelistService.requestApproval(ctx, phone, pushName);
            await ctx.reply('*Permohonan Akses Terkirim*\n\nPermohonan Anda telah dikirim ke admin. Mohon tunggu approval — Anda akan menerima notifikasi setelah keputusan dibuat.');
            return;
        }

        await ctx.reply('Akses tidak diizinkan.');
    } catch (err) {
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`waWhitelistCheck: ${err.message}`)
        );
        // Fail-open
        return next();
    }
};

/**
 * Imperatively flush a single user's cache entry. Called from approve/reject
 * handler so the freshly-approved/rejected user gets new decision immediately.
 */
waWhitelistCheckMiddleware.invalidateUser = (botId, phone) => {
    const key = `${botId ?? 'single'}:${phone}`;
    _accessCache.delete(key);
};

module.exports = waWhitelistCheckMiddleware;
