const { isAdmin } = require('../../utils/checkRole');

const caraCheckBalance = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Check Balance*

*Fungsi:* Melihat informasi detail saldo user tertentu

*Format Command:*
\`.checkbalance [USER_ID]\`

*Contoh Penggunaan:*
\`.checkbalance 6281234567890@s.whatsapp.net\`

*Informasi yang Ditampilkan:*
• Saldo saat ini
• Total top-up yang pernah dilakukan
• Total pengeluaran
• Waktu terakhir update saldo

*Alias:* \`.ceksaldo\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraCheckBalance;
