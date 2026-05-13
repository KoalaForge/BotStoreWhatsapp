const { isAdmin } = require('../../utils/checkRole');

const caraDelProduct = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Delete Product*

Kalian cukup command \`.delproduct <number_produk>\` untuk number_produk yang kamu masukkan adalah angka product nya yang dari listproduct

*Contoh:* \`.delproduct 1\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDelProduct;
