const { isAdmin } = require('../../utils/checkRole');

const caraDeactivateProduct = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Menonaktifkan Produk*

Kalian tinggal command \`.deactivateproduct <code product>\`

*Contoh:*
\`.deactivateproduct netflix\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDeactivateProduct;
