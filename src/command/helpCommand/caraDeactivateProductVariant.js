const { isAdmin } = require('../../utils/checkRole');

const caraDeactivateProductVariant = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Menonaktifkan Produk Variant*

Kalian tinggal command \`.deactivateproductvariant <code variant>\`

*Contoh:*
\`.deactivateproductvariant netflix-1b\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDeactivateProductVariant;
