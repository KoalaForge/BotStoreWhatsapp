const { isAdmin } = require('../../utils/checkRole');

const caraSetHarga = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Harga*

Cara mengatur harga product variant hanya dengan cara \`.setharga <new_price> <code_variant>\` dan new price hanya boleh angka saja!

*Contoh:* \`.setharga 20000 net1b\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetHarga;
