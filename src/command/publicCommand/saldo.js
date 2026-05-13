const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const { formatMoney } = require('../../database/models/money');
const { getCompanyName } = require('../../utils/getCompanyName');
const settingsService = require('../../services/settingsService');
const { isFeatureEnabled } = require('../../utils/featureFlags');
const screenState = require('../../state/screenState');

const saldoCommand = async (ctx) => {
    try {
        if (!await isFeatureEnabled(ctx, 'saldoEnabled')) {
            return ctx.reply(
                '*Fitur saldo tidak tersedia*\n\nFitur saldo sedang dinonaktifkan. Silakan hubungi admin.'
            );
        }

        const jid = ctx.from;

        // Get or create user balance
        let userBalance = await botUserBalanceRepository.findByUserId(ctx, jid);

        if (!userBalance) {
            userBalance = await botUserBalanceRepository.create(ctx, {
                userId: jid,
                balance: 0,
                totalTopUp: 0,
                totalSpent: 0
            });
        }

        // Get company name with priority fallback
        const settings = await settingsService.getSettings(ctx);
        const companyName = await getCompanyName(settings, ctx.state?.botId);

        const text = [
            `*Saldo — ${companyName}*`,
            '',
            `*Saldo:* ${formatMoney(userBalance.balance)}`,
            '',
            '*Top-up — ketik salah satu:*',
            '· `topup 10000` — Rp 10.000',
            '· `topup 25000` — Rp 25.000',
            '· `topup 50000` — Rp 50.000',
            '· `topup 100000` — Rp 100.000',
            '· `topup <nominal>` — Custom (min. 5.000)',
            '',
            'Ketik *kembali* untuk batal.'
        ].join('\n');

        screenState.setScreen(jid, 'SALDO_TOPUP');

        await ctx.reply(text);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/publicCommand/saldo.js: ${err.message}`)}`);
    }
};

module.exports = saldoCommand;
