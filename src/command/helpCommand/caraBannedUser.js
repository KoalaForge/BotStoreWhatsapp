const { isAdmin } = require('../../utils/checkRole');

const caraBannedUser = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Banned User*

*Command:* \`.banned <whatsapp_id> <alasan>\`

*Contoh penggunaan:*
\`.banned 6281234567890@s.whatsapp.net spam berlebihan\`
\`.banned 6289876543210@s.whatsapp.net melakukan penipuan\`

*Keterangan:*
• User yang di-banned tidak dapat berinteraksi dengan bot
• Sistem akan mencatat siapa yang melakukan banned dan kapan
• User akan mendapat pesan otomatis jika mencoba menggunakan bot
• Alasan banned akan tersimpan untuk referensi admin

_Pastikan ID WhatsApp benar sebelum melakukan banned. Berikan alasan yang jelas dan spesifik._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraBannedUser;
