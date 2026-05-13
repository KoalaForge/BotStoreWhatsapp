const { isAdmin } = require('../../utils/checkRole');

const caraSetTopupPrefix = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Topup Prefix*

*Fungsi:* Mengatur prefix untuk ID transaksi top-up saldo

*Format Command:*
\`.settopupprefix [PREFIX]\`

*Contoh Penggunaan:*
\`.settopupprefix TOPUP\`
\`.settopupprefix TU\`
\`.settopupprefix SALDO\`

*Format ID Transaksi:*
\`PREFIX-YYMMDD-4DIGIT+2LETTER\`

*Contoh Hasil:*
\`TOPUP-251117-1234XY\`
\`TU-251117-5678AB\`

*Keterangan:*
• Prefix hanya boleh huruf kapital dan angka
• Maksimal 10 karakter
• Prefix akan disimpan di database settings
• Jika settings tidak ada, akan menggunakan .env sebagai fallback
• Default: TOPUP

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetTopupPrefix;
