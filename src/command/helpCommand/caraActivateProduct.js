const { isAdmin } = require('../../utils/checkRole');

const caraActivateProduct = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Mengaktifkan Produk*

Kalian tinggal command \`.activateproduct <code product>\`

*Contoh:*
\`.activateproduct netflix\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraActivateProduct;
