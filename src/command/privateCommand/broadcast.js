const moment = require('moment-timezone');
const clc = require('cli-color');
const botUserRepository = require('../../repositories/BotUserRepository');
const { broadcastQueue } = require('../../utils/queue');
const { requireAdmin } = require('../../middleware/waAuth');

const broadcastCommand = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const broadcastText = ctx.commandText || '';

        if (!broadcastText) {
            return ctx.reply(
                `*Broadcast*\n\n` +
                `*Penggunaan:*\n` +
                `.broadcast <pesan yang ingin dikirim>\n\n` +
                `*Contoh:*\n` +
                `.broadcast Halo semua! Ada promo spesial hari ini.\n\n` +
                `_Pesan akan dikirim ke semua user yang terdaftar._`
            );
        }

        const allBotUsers = await botUserRepository.find(ctx, {});
        const messageToBroadcast = `*Broadcast*\n\n${broadcastText}`;

        let sent = 0;
        let failed = 0;

        for (const data of allBotUsers) {
            broadcastQueue.add(async () => {
                try {
                    const targetJid = data.idTelegram || data.userId;
                    if (!targetJid) return;

                    await ctx.sendTo(targetJid, { text: messageToBroadcast });
                    sent++;
                } catch (err) {
                    failed++;
                }
            });
        }

        await ctx.reply(
            `*Broadcast dijadwalkan*\n\n` +
            `Total target: ${allBotUsers.length} user\n\n` +
            `_Pesan sedang dikirim secara bertahap._`
        );

    } catch (err) {
        await ctx.reply('*Gagal mengirim broadcast. Silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in broadcast: ${err.message}`));
    }
};

module.exports = broadcastCommand;
