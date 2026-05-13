const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * List all CS links
 * Usage: .listcs
 */
const listCS = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const settings = await settingsService.getSettings(ctx);
        const rawLinks = settings?.csLinks || [];
        const csLinks = settingsService.normalizeCSLinks(rawLinks);

        if (csLinks.length === 0) {
            return ctx.reply(
                `*Daftar CS Link*\n\n` +
                `Belum ada CS link yang terdaftar.\n\n` +
                `Gunakan .addcs <link> <label> untuk menambahkan CS link.\n\n` +
                `*Contoh:*\n` +
                `.addcs @cs_koala Telegram Admin`
            );
        }

        const listMessage =
            `*Daftar CS Link*\n\n` +
            csLinks.map((cs, i) => `${i + 1}. *${cs.label}*\n   ${cs.link}`).join('\n\n') +
            `\n\n*Total:* ${csLinks.length} CS link terdaftar`;

        return ctx.reply(listMessage);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in listCS: ${err.message}`)
        );
    }
};

module.exports = listCS;
