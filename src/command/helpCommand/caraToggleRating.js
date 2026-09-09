const { requireAdmin } = require('../../middleware/waAuth');

const caraToggleRating = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        await ctx.reply(`*Panduan Mengatur Rating Produk*

Rating adalah penilaian bintang dan ulasan pembeli setelah pesanan selesai. Pengaturan ini khusus admin bot.

*Cek status*
Kirim \`.togglerating\` untuk melihat status tanpa mengubah pengaturan.

*Aktifkan rating*
Kirim \`.togglerating on\` agar pembeli dapat memberi rating dan ringkasan rating ditampilkan pada produk.

*Nonaktifkan rating*
Kirim \`.togglerating off\` untuk menyembunyikan ringkasan rating dan menghentikan pengiriman penilaian baru oleh pembeli. Rating dan ulasan lama tetap tersimpan, tidak dihapus.

Kirim \`.togglerating\` lagi untuk memastikan statusnya.
Untuk membuka panduan ini kembali: \`.caratogglerating\`.

_Ketik .adminmenu untuk kembali_`);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraToggleRating;
