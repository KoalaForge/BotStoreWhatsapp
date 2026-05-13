const { isAdmin } = require('../../utils/checkRole');

const caraSetProfitStock = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Profit Stock*

Cara nya hampir sama dengan addstock tetapi cara kerja nya set profit data. Untuk set profit pada stock, kamu hanya dengan cara mengetik command \`.setprofitstock <code_variant>|<jumlahprofit>\`

*Contoh:*
\`.setprofitstock netflix-1b|5000\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetProfitStock;
