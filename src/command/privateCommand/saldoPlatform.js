const { requireAdmin } = require('../../middleware/waAuth');
const modeService = require('../../services/modeService');
const ownerBalanceService = require('../../services/ownerBalanceService');
const messageFormatter = require('../../utils/waMessageFormatter');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');

const saldoPlatform = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;
        if (modeService.isSingleMode()) return;

        const ownerId = ctx.repositoryContext?.ownerId;
        if (!ownerId) return;

        const summary = await ownerBalanceService.getBalanceSummary(ownerId);
        const recentHistory = await ownerBalanceService.getRecentHistory(ownerId, 5);

        const message = messageFormatter.formatPlatformBalanceDisplay({
            balance: summary.balance,
            totalTopup: summary.total_topup,
            totalSpent: summary.total_spent,
            recentHistory
        });

        await ctx.reply(message);

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        await ctx.reply(`*Terjadi kesalahan, silakan coba lagi.*\n\n_${sanitizeErrorMessage(err)}_`);
    }
};

module.exports = saldoPlatform;
