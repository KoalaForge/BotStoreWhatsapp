const adminRepository = require('../../repositories/AdminRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Format JID for display: strip @s.whatsapp.net suffix.
 */
function displayJID(jid) {
    if (!jid) return 'N/A';
    return jid.replace('@s.whatsapp.net', '');
}

/**
 * List all admins (WhatsApp version).
 * Usage: .listadmin
 */
const listAdmin = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const admins = await adminRepository.find(ctx, {});

        if (admins.length < 1) {
            return ctx.reply('Tidak ada admin.');
        }

        let text = '*Daftar Admin*\n\n';

        admins.forEach((admin, index) => {
            const jid = admin.idWhatsapp || admin.idTelegram || 'N/A';
            text += `${index + 1}. \`${displayJID(jid)}\`\n`;
        });

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/listAdmin.js  ${err.message}`));
    }
};

module.exports = listAdmin;
