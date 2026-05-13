const { isAdmin } = require('../../utils/checkRole');

const caraAddBalance = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Balance*

*Fungsi:* Menambahkan saldo ke akun user tertentu

*Format Command:*
\`.addbalance [USER_ID] [NOMINAL]\`

*Contoh Penggunaan:*
\`.addbalance 6281234567890@s.whatsapp.net 50000\`
\`.addbalance 6281234567890@s.whatsapp.net 100000\`

*Keterangan:*
• USER_ID: ID WhatsApp user yang akan ditambah saldonya
• NOMINAL: Jumlah saldo yang akan ditambahkan (dalam Rupiah)
• Maksimal nominal: Rp 100.000.000
• Jika user belum memiliki data saldo, akan otomatis dibuatkan

*Alias:* \`.addsaldo\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraAddBalance;
