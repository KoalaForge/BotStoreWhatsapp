const caraToggleRestokInfo = async (ctx) => {
    try {
        const text = `*Panduan Toggle Info Restok*

Fitur ini menambahkan baris *🔄 Restok* di tiap variant pada hasil \`.list\` / \`.produk\` / \`.listproduk\`, menampilkan kapan stok terakhir kali ditambahkan dalam format relative time (mis: _5 jam lalu_, _1 hari lalu_, _1 minggu lalu_).

*Default:* Nonaktif — bisa diaktifkan per-grup ATAU di DM (global per-bot).

*Command:* \`.togglerestokinfo <on|off>\`

*Contoh:*
\`.togglerestokinfo on\` — Aktifkan info restok
\`.togglerestokinfo off\` — Sembunyikan info restok
\`.togglerestokinfo\` — Cek status saat ini

*Alias:* \`.togglelastrestock\`, \`.togglerestock\`

*Scope toggle:*
• Jalankan di *grup* → toggle hanya berlaku untuk grup itu (disimpan di groupSettings)
• Jalankan di *DM* → toggle berlaku global per-bot (default untuk DM + semua grup yang belum di-set sendiri)

*Contoh use case:*
• Aktifkan untuk grup tertentu saja: jalankan \`.togglerestokinfo on\` di dalam grup tsb
• Aktifkan untuk semua DM customer + grup yang belum set: jalankan \`.togglerestokinfo on\` di DM bot
• Grup yang sudah set sendiri (on/off) tidak terpengaruh oleh setting DM/global

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
• Variant reseller juga ikut tampil — pakai data stok platform (ownerId=null)
• Mode \`.compactlist\` tidak terpengaruh — format ringkas tetap

*Catatan:*
_Sumber data: tanggal entry terbaru di koleksi stok lokal (atau stok platform untuk reseller variant). Setiap kali admin menjalankan_ \`.addstock\` _atau platform menambah stok, entry baru dibuat sehingga "Restok" mencerminkan waktu addstock terakhir._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraToggleRestokInfo;
