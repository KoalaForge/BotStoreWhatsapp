const { isAdmin } = require('../../utils/checkRole');

const caraDelVariant = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Delete Variant*

Cara untuk menghapus variant product hanya dengan cara mengetik command \`.delvariant <code_variant>\`

*Contoh:* \`.delvariant spo1b\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDelVariant;
