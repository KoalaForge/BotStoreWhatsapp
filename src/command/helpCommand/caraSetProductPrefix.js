const { isAdmin } = require('../../utils/checkRole');

const caraSetProductPrefix = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Product Prefix*

*Fungsi:* Mengatur prefix untuk ID transaksi pembelian produk

*Format Command:*
\`.setproductprefix [PREFIX]\`

*Contoh Penggunaan:*
\`.setproductprefix INV\`
\`.setproductprefix ORDER\`
\`.setproductprefix PROD\`

*Format ID Transaksi:*
\`PREFIX-YYMMDD-4DIGIT+2LETTER\`

*Contoh Hasil:*
\`INV-251117-1234AB\`
\`ORDER-251117-5678CD\`

*Keterangan:*
• Prefix hanya boleh huruf kapital dan angka
• Maksimal 10 karakter
• Prefix akan disimpan di database settings
• Jika settings tidak ada, akan menggunakan .env sebagai fallback
• Default: INV

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetProductPrefix;
