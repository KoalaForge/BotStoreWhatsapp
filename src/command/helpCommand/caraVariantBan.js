const moment = require('moment-timezone');
const clc = require('cli-color');
const { requireAdmin } = require('../../middleware/waAuth');

const caraVariantBan = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const text = `*Cara Ban Variant / Produk*

Blokir user tertentu agar tidak bisa membeli variant tertentu, atau seluruh variant dari satu produk. User yang diblokir ditolak saat buka detail variant maupun saat bayar (QRIS & saldo). Blokir langsung berlaku — tidak perlu toggle apa pun.

*Blokir per variant:*
.banvariant <codeVariant> <nomor> [alasan]
Contoh: .banvariant netflix-1bln 6281234567890 spam

*Blokir seluruh produk (semua variant):*
.banproduct <productCode> <nomor> [alasan]
Contoh: .banproduct netflix 6281234567890 penipuan

*Buka blokir:*
.unbanvariant <codeVariant> <nomor>
.unbanproduct <productCode> <nomor>

*Lihat daftar:*
.listvariantban [halaman]

*Inti:*
- codeVariant = kode variant (mis. netflix-1bln). productCode = kode produk (mis. netflix).
- Ban = daftar-larang. Diblokir saat buka produk, buka detail variant, bayar QRIS, dan bayar saldo.
- Ban produk = blokir semua variant produk itu sekaligus.
- Blokir langsung berlaku begitu Anda ban user — tidak ada toggle.
- Buka blokir dengan .unbanvariant atau .unbanproduct.
- Admin tidak pernah ikut terblokir.`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('*Terjadi error saat menjalankan command.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`caraVariantBan: ${err.message}`)
        );
    }
};

module.exports = caraVariantBan;
