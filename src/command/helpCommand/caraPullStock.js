const { isAdmin } = require('../../utils/checkRole');

const caraPullStock = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Pull Stock*

Kalian tinggal kirim command dengan format:
\`.pullstock <code_variant> <jumlah>\`

*Contoh:*
\`.pullstock netflix-1b 5\`

_Harap perhatikan format command nya_

---

*Cara Pull Stock Reseller*

Untuk produk reseller, pullstock menggunakan stok platform dan memotong saldo platform Anda.

*Langkah-langkah*

1. Lihat kode variant platform di Show Products (kode di bawah "Platform Code")
2. Kirim: \`.pullstock <platform_variant_code> <jumlah>\`
   Contoh: \`.pullstock yt-1bln 5\`

*Penting:*
• Pullstock reseller memotong saldo platform (bukan stok sendiri)
• Pastikan saldo platform mencukupi sebelum pullstock
• Cek saldo: \`.saldoplatform\`
• Top up saldo: \`.topupplatform\`

*Perbedaan*

• Normal: mengambil dari stok sendiri, tanpa potong saldo
• Reseller: mengambil dari stok platform, potong saldo platform

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraPullStock;
