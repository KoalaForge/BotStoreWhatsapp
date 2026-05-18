const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserRepository = require('../repositories/BotUserRepository');
const { isAdmin } = require('../utils/checkRole');

/**
 * WhatsApp Spam Guard Middleware
 *
 * Per-user incoming DM throttle with two tiers:
 *   - Tier 1 (WARN):   10 msgs / 60s → reply once with warning, then silent drop
 *     for WARN_QUIET_MS so repeated warn-spam doesn't compound.
 *   - Tier 2 (BLOCK):  30 msgs / 60s → persist `spam_blocked_until = now + 1h`
 *     in DB, then silent drop. Survives bot restart.
 *
 * Skips groups (already filtered by waGroupFilter) and admins.
 * Block status is cached in-memory for 60s to avoid hammering Mongo on every
 * incoming message — same pattern as waBanCheck.
 */

const WINDOW_MS = 60_000;
const WARN_THRESHOLD = 10;
const BLOCK_THRESHOLD = 30;
const BLOCK_DURATION_MS = 60 * 60 * 1000;
const WARN_QUIET_MS = 60_000;
const BLOCK_CACHE_TTL_MS = 60_000;

/** @type {Map<string, { timestamps: number[], warnedAt: number|null }>} */
const _counters = new Map();

/** @type {Map<string, { blockedUntil: number|null, ts: number }>} */
const _blockCache = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _counters.entries()) {
        const fresh = entry.timestamps.filter(ts => now - ts < WINDOW_MS);
        const warnStale = entry.warnedAt && now - entry.warnedAt > WARN_QUIET_MS;
        if (fresh.length === 0 && (warnStale || !entry.warnedAt)) {
            _counters.delete(key);
        } else {
            entry.timestamps = fresh;
            if (warnStale) entry.warnedAt = null;
            _counters.set(key, entry);
        }
    }
    for (const [key, entry] of _blockCache.entries()) {
        if (now - entry.ts > BLOCK_CACHE_TTL_MS) _blockCache.delete(key);
    }
}, WINDOW_MS).unref();

function _logBlock(userId, until) {
    console.log(
        clc.red.bold('[ SPAM BLOCK ]') +
        ` [${moment().format('HH:mm:ss')}]` +
        clc.yellow(` user=${userId} until=${moment(until).tz('Asia/Jakarta').format('HH:mm:ss')}`)
    );
}

async function _isCurrentlyBlocked(ctx, userId) {
    const cached = _blockCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.ts < BLOCK_CACHE_TTL_MS) {
        if (!cached.blockedUntil) return false;
        if (cached.blockedUntil > now) return true;
        // expired in cache — fall through to DB to confirm/clear
    }

    const user = await botUserRepository.findByWhatsappId(ctx, userId);
    const until = user?.spam_blocked_until ? new Date(user.spam_blocked_until).getTime() : null;
    _blockCache.set(userId, { blockedUntil: until, ts: now });
    return !!(until && until > now);
}

const waSpamGuardMiddleware = async (ctx, next) => {
    try {
        if (ctx.isGroup) return next();
        const userId = ctx.from;
        if (!userId) return next();

        if (await isAdmin(userId, ctx)) return next();

        if (await _isCurrentlyBlocked(ctx, userId)) {
            return; // silent drop
        }

        const now = Date.now();
        const entry = _counters.get(userId) || { timestamps: [], warnedAt: null };
        entry.timestamps = entry.timestamps.filter(ts => now - ts < WINDOW_MS);
        entry.timestamps.push(now);

        const count = entry.timestamps.length;

        if (count >= BLOCK_THRESHOLD) {
            const until = new Date(now + BLOCK_DURATION_MS);
            await botUserRepository.setSpamBlock(
                ctx,
                userId,
                until,
                'auto: spam rate exceeded'
            );
            _blockCache.set(userId, { blockedUntil: until.getTime(), ts: now });
            _counters.delete(userId);
            _logBlock(userId, until);
            return; // silent drop
        }

        if (count >= WARN_THRESHOLD) {
            const stillQuiet = entry.warnedAt && now - entry.warnedAt < WARN_QUIET_MS;
            if (!stillQuiet) {
                entry.warnedAt = now;
                _counters.set(userId, entry);
                await ctx.reply(
                    '*Terlalu cepat.*\n\nMohon kurangi kecepatan kirim pesan. Lanjut spam akan diblokir otomatis 1 jam.'
                );
            } else {
                _counters.set(userId, entry);
            }
            return; // drop this message regardless
        }

        _counters.set(userId, entry);
        return next();
    } catch (err) {
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in waSpamGuard: ${err.message}`)
        );
        return next();
    }
};

module.exports = waSpamGuardMiddleware;
