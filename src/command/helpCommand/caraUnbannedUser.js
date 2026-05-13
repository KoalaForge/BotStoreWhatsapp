const { isAdmin } = require('../../utils/checkRole');

const caraUnbannedUser = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Unbanned User*

*Command:* \`.unbanned <whatsapp_id>\`

*Contoh penggunaan:*
\`.unbanned 6281234567890@s.whatsapp.net\`
\`.unbanned 6289876543210@s.whatsapp.net\`

*Keterangan:*
• Perintah ini akan menghapus status banned dari user
• User dapat kembali berinteraksi dengan bot seperti biasa
• Sistem akan mencatat siapa yang melakukan unbanned dan kapan
• Data banned sebelumnya akan dihapus dari database

_Pastikan ID WhatsApp benar sebelum melakukan unbanned. User harus sudah dalam status banned untuk bisa di-unbanned._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraUnbannedUser;
