const adminRepository = require('../../repositories/AdminRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID } = require('../../utils/jidHelper');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Add a new admin (WhatsApp version).
 * Usage: .addadmin <whatsappJID or phone>
 */
const addAdmin = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.addadmin <JID atau nomor>`\n\n' +
                '*Contoh:*\n' +
                '`.addadmin 6281234567890`\n' +
                '`.addadmin 6281234567890@s.whatsapp.net`'
            );
        }

        const jid = normalizeJID(args[0]);

        await adminRepository.create(ctx, {
            idWhatsapp: jid
        });

        await ctx.reply(
            `*Admin berhasil ditambahkan.*\n\n` +
            `*JID:* ${jid}`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/addAdmin.js  ${err.message}`));
    }
};

module.exports = addAdmin;
