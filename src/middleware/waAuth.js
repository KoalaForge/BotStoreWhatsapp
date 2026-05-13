const { isAdmin } = require('../utils/checkRole');

/**
 * WhatsApp Admin Authorization Middleware
 * Checks if the sender is an admin for admin-only commands.
 * Used selectively (not on every message) - commands register this check individually.
 */
async function requireAdmin(ctx) {
    const userId = ctx.from; // WhatsApp JID
    const admin = await isAdmin(userId, ctx);

    if (!admin) {
        await ctx.reply('*Akses ditolak.* Perintah ini hanya untuk admin.');
        return false;
    }

    return true;
}

module.exports = { requireAdmin };
