const caraToggleRestokInfo = async (ctx) => {
    try {
        const text = `*Panduan Toggle Info Restok*

Fitur ini menambahkan baris *🔄 Restok* di tiap variant pada hasil \`.list\` / \`.produk\` / \`.listproduk\` di grup, menampilkan kapan stok terakhir kali ditambahkan dalam format relative time (mis: _5 jam lalu_, _1 hari lalu_, _1 minggu lalu_).

*Default: Nonaktif* — admin grup harus aktifkan manual per-grup.

*Command:* \`.togglerestokinfo <on|off>\`

*Contoh:*
\`.togglerestokinfo on\` — Aktifkan info restok
\`.togglerestokinfo off\` — Sembunyikan info restok
\`.togglerestokinfo\` — Cek status saat ini

*Alias:* \`.togglelastrestock\`, \`.togglerestock\`

*Format relative time:*
• < 1 menit  → _baru saja_
• < 1 jam    → _X menit lalu_
• < 1 hari   → _X jam lalu_
• < 1 minggu → _X hari lalu_
• < 1 bulan  → _X minggu lalu_
• < 1 tahun  → _X bulan lalu_
• ≥ 1 tahun  → _X tahun lalu_

*Dampak saat aktif:*
• Tiap variant di \`.list\` menampilkan baris 🔄 Restok dengan waktu relatif
• Variant yang stoknya pernah ada lalu habis terjual (entry stok terhapus) tidak menampilkan baris ini
• Variant reseller (stok dari platform) juga tidak menampilkan baris ini
• Mode \`.compactlist\` tidak terpengaruh — format ringkas tetap

*Catatan:*
_Sumber data: tanggal entry terbaru di koleksi stok lokal. Setiap kali admin menjalankan_ \`.addstock\` _entry baru dibuat, sehingga "Restok" mencerminkan waktu_ \`.addstock\` _terakhir._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraToggleRestokInfo;
