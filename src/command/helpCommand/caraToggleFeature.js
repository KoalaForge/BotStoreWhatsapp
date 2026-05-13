const caraToggleFeature = async (ctx) => {
    try {
        const text = `*Panduan Toggle Fitur*

Fitur toggle memungkinkan admin mengaktifkan atau menonaktifkan fitur tertentu tanpa perlu restart bot.

*Toggle Fitur Saldo*

*Command:* \`.togglesaldo <on|off>\`

*Contoh:*
\`.togglesaldo off\` — Nonaktifkan fitur saldo
\`.togglesaldo on\` — Aktifkan kembali fitur saldo

*Dampak saat saldo dinonaktifkan:*
• Command \`.saldo\` ditolak dengan pesan informatif
• Opsi "Bayar dengan Saldo" hilang dari menu pesanan
• Konfirmasi bayar saldo ditolak (mitigasi)

*Toggle Fitur Chat*

*Command:* \`.togglechat <on|off>\`

*Contoh:*
\`.togglechat off\` — Nonaktifkan fitur chat
\`.togglechat on\` — Aktifkan kembali fitur chat

*Dampak saat chat dinonaktifkan:*
• Command \`.chat\` ditolak dengan pesan informatif
• Pemilihan kategori chat ditolak (mitigasi)

*Toggle Halaman Welcome*

*Command:* \`.togglewelcome <on|off>\`

*Contoh:*
\`.togglewelcome off\` — Nonaktifkan halaman welcome
\`.togglewelcome on\` — Aktifkan kembali halaman welcome

*Dampak saat welcome dinonaktifkan:*
• Command \`.start\` langsung menampilkan daftar produk
• Statistik bot dan banner intro dilewati

*Cek Status Fitur*

Ketik command tanpa argumen untuk cek status saat ini:
\`.togglesaldo\` — Cek status fitur saldo
\`.togglechat\` — Cek status fitur chat
\`.togglewelcome\` — Cek status halaman welcome

_Perubahan berlaku seketika. Customer yang sedang aktif di sesi chat tidak terdampak — hanya sesi baru yang diblokir._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraToggleFeature;
