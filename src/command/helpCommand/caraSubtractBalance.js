const { isAdmin } = require('../../utils/checkRole');

const caraSubtractBalance = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Subtract Balance*

*Fungsi:* Mengurangi saldo dari akun user tertentu

*Format Command:*
\`.subtractbalance [USER_ID] [NOMINAL]\`

*Contoh Penggunaan:*
\`.subtractbalance 6281234567890@s.whatsapp.net 50000\`
\`.subtractbalance 6281234567890@s.whatsapp.net 25000\`

*Keterangan:*
• USER_ID: ID WhatsApp user yang akan dikurangi saldonya
• NOMINAL: Jumlah saldo yang akan dikurangi (dalam Rupiah)
• Saldo user harus mencukupi untuk pengurangan
• Jika user belum memiliki data saldo, akan muncul error

*Alias:* \`.kurangisaldo\`, \`.reducesaldo\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSubtractBalance;
