const caraCS = async (ctx) => {
    try {
        const text = `*Panduan CS Link*

Fitur CS Link memungkinkan Anda menampilkan kontak Customer Service ke customer melalui command \`.cs\`.

*Menambah CS Link*

*Command:* \`.addcs <link> <label>\`

*Parameter:*
• \`link\` - Link CS (wajib)
• \`label\` - Label untuk tombol (wajib, boleh pakai spasi)

*Format link yang diterima:*
• \`@username\` - Username Telegram
• \`t.me/username\` - Link Telegram
• \`wa.me/628xxx\` - Link WhatsApp
• \`facebook.com/halaman\` - Link lainnya

*Contoh:*
\`.addcs @cs_koala Telegram Admin\`
\`.addcs wa.me/6281234567890 WhatsApp CS\`
\`.addcs t.me/group_support Grup Support\`

*Menghapus CS Link*

*Command:* \`.removecs <link>\`

*Contoh:*
\`.removecs @cs_koala\`
\`.removecs t.me/cs_koala\`

*Melihat Daftar CS*

*Command:* \`.listcs\`

Menampilkan semua CS link beserta label yang sudah terdaftar.

*Customer Mengakses CS*

Customer ketik \`.cs\` untuk melihat daftar CS yang tersedia.

_Pastikan link CS yang ditambahkan valid dan aktif._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraCS;
