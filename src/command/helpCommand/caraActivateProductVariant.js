const { isAdmin } = require('../../utils/checkRole');

const caraActivateProductVariant = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Mengaktifkan Produk Variant*

Kalian tinggal command \`.activateproductvariant <code variant>\`

*Contoh:*
\`.activateproductvariant netflix-1b\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraActivateProductVariant;
