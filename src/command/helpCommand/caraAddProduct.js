const { isAdmin } = require('../../utils/checkRole');

const caraAddProduct = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Product*

Kalian tinggal command \`.addproduct\` dan tinggal isi apa yang disuruhkan oleh bot

*Contoh:*
\`.addproduct NETFLIX Netflix Premium Akun Netflix Premium\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraAddProduct;
