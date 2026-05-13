const caraRecapProduct = async (ctx) => {
    try {
        const text = `*Panduan Rekap Penjualan Per Produk*

*Command:* \`.rekapproduk\`
*Alias:* \`recapproduct\`, \`rekapproduct\`

*Format:*
\`.rekapproduk [kode_produk] [kode_variant] [tanggal]\`
Semua parameter opsional.

*Contoh Penggunaan*

\`.rekapproduk\`
→ Semua produk, hari ini

\`.rekapproduk MLBB\`
→ Produk MLBB, semua variant, hari ini

\`.rekapproduk MLBB mlbb-86dm\`
→ Produk MLBB, variant mlbb-86dm, hari ini

\`.rekapproduk 20/02/2026\`
→ Semua produk, tanggal 20 Feb

\`.rekapproduk 18/02/2026-25/02/2026\`
→ Semua produk, range 18 s/d 25 Feb

\`.rekapproduk MLBB 18/02/2026-25/02/2026\`
→ MLBB semua variant, 18 s/d 25 Feb

\`.rekapproduk MLBB mlbb-86dm 18/02/2026-25/02/2026\`
→ MLBB variant 86dm, 18 s/d 25 Feb

*Tingkatan Detail*

*Semua produk:* ringkasan total per variant (qty, pendapatan, profit)
*1 produk:* log transaksi per trx: siapa beli, jam, metode bayar, data stok
*1 produk + 1 variant:* sama seperti di atas, difilter ke variant tertentu

*Format Tanggal*

Gunakan DD/MM/YYYY — contoh: \`25/02/2026\`
Range: DD/MM/YYYY-DD/MM/YYYY (tanpa spasi)
Contoh range: \`18/02/2026-25/02/2026\`

*Tips:*
• Gunakan \`*\` sebagai wildcard semua produk dengan tanggal tertentu
  Contoh: \`.rekapproduk * 25/02/2026\`
• Kode produk & variant sesuai yang terdaftar di bot

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraRecapProduct;
