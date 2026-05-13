const { isAdmin } = require('../../utils/checkRole');

const caraDelStock = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Delete Stock*

Cara nya hampir sama dengan addstock tetapi cara kerja nya menghapus data. Untuk menghapus stock kamu hanya dengan cara mengetik command \`.delstock <code_variant>\`

*Contoh:*
\`.delstock netflix-1b\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDelStock;
