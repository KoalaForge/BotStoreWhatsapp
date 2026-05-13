const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Remove a CS link
 * Usage: .removecs <link>
 */
const removeCS = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length === 0) {
            return ctx.reply(
                `*Hapus CS Link*\n\n` +
                `*Penggunaan:*\n` +
                `.removecs <link>\n\n` +
                `*Contoh:*\n` +
                `.removecs @cs_koala\n` +
                `.removecs t.me/cs_koala\n` +
                `.removecs wa.me/6281234567890\n\n` +
                `Gunakan .listcs untuk melihat daftar CS yang terdaftar.`
            );
        }

        const link = args[0].trim();
        const result = await settingsService.removeCSLink(ctx, link);

        if (!result.removed) {
            return ctx.reply(
                `*CS link tidak ditemukan*\n\n` +
                `Link ${link} tidak ada dalam daftar CS.\n\n` +
                `Gunakan .listcs untuk melihat CS link yang terdaftar.`
            );
        }

        await ctx.reply(
            `*CS link berhasil dihapus*\n\n` +
            `*Link:* ${link}\n\n` +
            `Gunakan .listcs untuk melihat sisa CS link.`
        );

        console.log(
            clc.green.bold("[ SUCCESS ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`CS link '${link}' removed by user ${ctx.from}`)
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in removeCS: ${err.message}`)
        );
    }
};

module.exports = removeCS;
