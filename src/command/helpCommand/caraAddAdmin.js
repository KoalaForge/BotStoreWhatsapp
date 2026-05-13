const { isAdmin } = require('../../utils/checkRole');

const caraAddAdmin = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Admin*

Kalian tinggal command \`.addadmin <id whatsapp>\`

*Contoh:*
\`.addadmin 6281234567890@s.whatsapp.net\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraAddAdmin;
