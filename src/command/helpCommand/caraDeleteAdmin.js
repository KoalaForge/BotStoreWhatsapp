const { isAdmin } = require('../../utils/checkRole');

const caraDeleteAdmin = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Delete Admin*

Kalian tinggal command \`.deleteadmin <id whatsapp>\`

*Contoh:*
\`.deleteadmin 6281234567890@s.whatsapp.net\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDeleteAdmin;
