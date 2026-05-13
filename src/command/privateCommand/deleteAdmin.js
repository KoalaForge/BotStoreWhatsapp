const adminRepository = require('../../repositories/AdminRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { toJid: normalizeJID } = require('../../utils/jidHelper');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Delete an admin (WhatsApp version).
 * Usage: .deleteadmin <whatsappJID or phone>
 */
const deleteAdmin = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.deleteadmin <JID atau nomor>`\n\n' +
                '*Contoh:*\n' +
                '`.deleteadmin 6281234567890`\n' +
                '`.deleteadmin 6281234567890@s.whatsapp.net`'
            );
        }

        const jid = normalizeJID(args[0]);

        const admin = await adminRepository.findByWhatsappId(ctx, jid);

        if (!admin) {
            return ctx.reply('*Admin tidak ditemukan.*');
        }

        await adminRepository.deleteOne(ctx, { idWhatsapp: admin.idWhatsapp });

        await ctx.reply(
            `*Admin berhasil dihapus.*\n\n` +
            `*JID:* ${jid}`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/deleteAdmin.js  ${err.message}`));
    }
};

module.exports = deleteAdmin;
