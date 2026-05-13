const botUserRepository = require('../repositories/BotUserRepository');
const clc = require('cli-color');
const moment = require('moment-timezone');
const { isAdmin } = require('../utils/checkRole');

// In-memory ban status cache (same pattern as Telegram version)
const _banCache = new Map();
const BAN_CACHE_TTL_MS = 60_000;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _banCache.entries()) {
        if (now - entry.ts > BAN_CACHE_TTL_MS) _banCache.delete(key);
    }
}, BAN_CACHE_TTL_MS).unref();

/**
 * WhatsApp Ban Check Middleware
 * Checks if the user's WhatsApp JID is banned.
 * Uses idWhatsapp instead of idTelegram for lookup.
 */
const waBanCheckMiddleware = async (ctx, next) => {
    try {
        const userId = ctx.from; // WhatsApp phone number

        if (userId && !await isAdmin(userId, ctx)) {
            const cached = _banCache.get(userId);

            if (cached && !cached.isBanned && (Date.now() - cached.ts) < BAN_CACHE_TTL_MS) {
                return next();
            }

            const user = await botUserRepository.findByWhatsappId(ctx, userId);
            const isBanned = !!(user && user.is_banned);

            if (!isBanned) {
                _banCache.set(userId, { isBanned: false, ts: Date.now() });
            }

            if (isBanned) {
                const banMessage = `*AKUN ANDA TELAH DIBLOKIR*

Maaf, akses Anda ke bot ini telah dibatasi karena:
*${user.ban_reason || 'Pelanggaran ketentuan penggunaan'}*

_Diblokir pada:_ ${user.banned_at ? moment(user.banned_at).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss') + ' WIB' : 'Tidak diketahui'}

_Untuk informasi lebih lanjut, silakan hubungi customer service kami._

Terima kasih atas pengertian Anda.`;

                return ctx.reply(banMessage);
            }
        }

        return next();
    } catch (err) {
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in waBanCheck: ${err.message}`)
        );
        return next();
    }
};

module.exports = waBanCheckMiddleware;
