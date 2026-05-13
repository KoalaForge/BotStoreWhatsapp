const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');
const { validateCSLink } = require('../../utils/csLinkValidator');

/**
 * Add a CS link with label
 * Usage: .addcs <link> <label>
 */
const addCS = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                `*Tambah CS Link*\n\n` +
                `*Penggunaan:*\n` +
                `.addcs <link> <label>\n\n` +
                `*Parameter:*\n` +
                `- link — Link CS (wajib)\n` +
                `- label — Label untuk button (wajib, boleh pakai spasi)\n\n` +
                `*Format link yang diterima:*\n` +
                `- @username — Username Telegram\n` +
                `- t.me/username — Link Telegram\n` +
                `- wa.me/628xxx — Link WhatsApp\n` +
                `- facebook.com/halaman — Link lainnya\n\n` +
                `*Contoh:*\n` +
                `.addcs @cs_koala Telegram Admin\n` +
                `.addcs wa.me/6281234567890 WhatsApp CS\n` +
                `.addcs t.me/group_support Grup Support\n\n` +
                `Gunakan .listcs untuk melihat CS link saat ini.`
            );
        }

        const rawLink = args[0].trim();
        const label = args.slice(1).join(' ').trim();

        if (label.length > 64) {
            return ctx.reply(
                `*Label terlalu panjang!*\n\nMaksimal 64 karakter untuk label button.`
            );
        }

        const validation = validateCSLink(rawLink);

        if (!validation.valid) {
            return ctx.reply(
                `*Format link tidak valid!*\n\n` +
                `${validation.reason}\n\n` +
                `*Format link yang diterima:*\n` +
                `- @username — Username Telegram\n` +
                `- t.me/username — Link Telegram\n` +
                `- wa.me/628xxx — Link WhatsApp\n` +
                `- facebook.com/halaman — Link lainnya\n\n` +
                `*Contoh:*\n` +
                `.addcs @cs_koala Telegram Admin\n` +
                `.addcs wa.me/6281234567890 WhatsApp CS`
            );
        }

        const normalizedLink = validation.normalized;
        const result = await settingsService.addCSLink(ctx, normalizedLink, label);

        if (!result.added) {
            return ctx.reply(
                `*CS link sudah terdaftar*\n\n` +
                `Link ${normalizedLink} sudah ada dalam daftar CS.\n\n` +
                `Gunakan .listcs untuk melihat semua CS link.`
            );
        }

        await ctx.reply(
            `*CS link berhasil ditambahkan*\n\n` +
            `*Label:* ${label}\n` +
            `*Link:* ${normalizedLink}\n\n` +
            `Gunakan .listcs untuk melihat semua CS link.`
        );

        console.log(
            clc.green.bold("[ SUCCESS ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`CS link '${normalizedLink}' (${label}) added by user ${ctx.from}`)
        );

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in addCS: ${err.message}`)
        );
    }
};

module.exports = addCS;
