const { isAdmin } = require('../../utils/checkRole');

const caraDelVariantSnk = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Delete SnK Varian*

Cara menghapus SnK pada variant product:

*Format:*
\`.delvariantsnk <codeVariant>\`

*Contoh:*
\`.delvariantsnk canva-1b\`

*Catatan:*
• Perintah ini akan menghapus seluruh SnK (Syarat & Ketentuan dan Ketentuan Garansi)
• Pastikan code variant sudah benar
• Tidak perlu reply ke pesan lain

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraDelVariantSnk;
