const { isAdmin } = require('../../utils/checkRole');

const caraAddVariant = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Variant*

Cara menambahkan variant product adalah dengan cukup ketik command \`.addvariant\` untuk bagian *Number product* kalian cukup masukkan nomor product yang ingin di masukkan

*Contoh:* Number product jika ingin menambahkan product 1 maka masukkan angka 1

_Harap perhatikan format command dan jangan lupa reply juga keterangan nya_

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraAddVariant;
