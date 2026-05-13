const { requireAdmin } = require('../../middleware/waAuth');
const modeService = require('../../services/modeService');
const ownerBalanceService = require('../../services/ownerBalanceService');
const { formatMoney } = require('../../database/models/money');
const moment = require('moment-timezone');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');

const TOPUP_NOMINALS = [50000, 100000, 200000, 500000, 1000000];

const topupPlatform = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;
        if (modeService.isSingleMode()) return;

        const ownerId = ctx.repositoryContext?.ownerId;
        if (!ownerId) return;

        const balance = await ownerBalanceService.getAvailableBalance(ownerId);

        let text = `*Top-Up Saldo Platform*\n\n`;
        text += `*Saldo saat ini:* ${formatMoney(balance)}\n\n`;
        text += `_Pilih nominal:_\n\n`;
        TOPUP_NOMINALS.forEach((nominal, i) => {
            text += `*${i + 1}.* ${formatMoney(nominal)}\n`;
        });
        text += `*${TOPUP_NOMINALS.length + 1}.* Nominal custom\n`;
        text += `\n_Ketik nomor atau nominal langsung (contoh: 150000)_`;

        await ctx.reply(text);

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        await ctx.reply(`*Terjadi kesalahan, silakan coba lagi.*\n\n_${sanitizeErrorMessage(err)}_`);
    }
};

module.exports = topupPlatform;
