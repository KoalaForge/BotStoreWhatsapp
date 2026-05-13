const clc = require('cli-color');
const moment = require('moment-timezone');

const helpCommand = async (ctx) => {
    try {
        const helpMessage = `*Panduan Order Lengkap*

Ikuti langkah berikut untuk berbelanja di bot ini. Semua perintah cukup diketik di chat — tidak perlu tombol.

*1. Mulai Belanja*
Ketik salah satu:
· \`menu\` — buka katalog produk
· \`.stok\` — lihat stok lengkap
· \`halo\` / \`hai\` — buka halaman awal
Bot akan tampilkan list produk bernomor.

*2. Pilih Produk*
Ketik *nomor produk* dari list (contoh: \`1\`).
Bot tampilkan variasi (varian) + harga + stok + jumlah terjual.

*3. Pilih Variasi*
Ketik *nomor variasi* yang diinginkan.
Bot masuk ke *Halaman Pesanan*.

*4. Halaman Pesanan — Menu Aksi*
Di halaman pesanan, ketik angka:
· \`1\` — Bayar QRIS
· \`2\` — Bayar Saldo
· \`3\` — Ubah Jumlah pesanan
· \`4\` — Pakai / Hapus Voucher
· \`5\` — Tambah Catatan Pembeli
· \`0\` — Kembali ke variasi

*5. Pintasan Cepat (Skip Menu)*
Kalau sudah tahu kode variant, langsung bayar tanpa pilih menu:
· \`buy <kode> <qty>\` — bayar QRIS
· \`buynow <kode> <qty>\` — bayar Saldo

Format: \`<qty>\` = jumlah pcs.
Contoh:
· \`buy NETFLIX1B 1\` — beli 1 pcs via QRIS
· \`buy NETFLIX1B 5\` — beli 5 pcs via QRIS
· \`buynow NETFLIX1B 3\` — beli 3 pcs via Saldo

_Kode variant terlihat di list produk / \`.stok\`._
_Jumlah otomatis cek stok — kalau melebihi stok, bot tolak._

*6. Pembayaran QRIS*
· Scan QR yang dikirim bot
· Transfer *persis* nominal yang tertera (jangan kurang/lebih)
· Batas waktu: *6 menit*
· Menit ke-5: bot kirim reminder
· Menit ke-6: pesanan auto-batal & stok dikembalikan
· Setelah bayar, tunggu 1–3 menit — produk dikirim otomatis

*7. Pembayaran Saldo*
· Cek saldo dulu via \`.saldo\`
· Pilih \`2\` di halaman pesanan
· Konfirmasi dengan \`1\` (atau \`2\` untuk batal)
· Produk langsung dikirim otomatis

*8. Top-up Saldo*
Ketik \`.saldo\` lalu pilih:
· \`1\` Rp10.000  · \`2\` Rp25.000
· \`3\` Rp50.000  · \`4\` Rp100.000
· \`5\` Custom (Rp5.000 – Rp10.000.000)
Atau ketik nominal langsung (min 5.000).

*9. Voucher Diskon*
Dua cara pakai voucher:
· Di halaman pesanan ketik \`4\`
· Atau ketik \`voucher\` lalu masukkan kode
Lihat voucher tersedia: \`.vouchers\`

*10. Riwayat Transaksi*
· \`riwayat\` — ringkasan
· \`riwayat pembelian\` — daftar pembelian
· \`riwayat deposit\` — daftar top-up
· Tambah \` semua\` untuk export full (contoh: \`riwayat pembelian semua\`)

*11. Navigasi & Pembatalan*
· \`0\` atau \`kembali\` — mundur satu layar
· \`menu\` — balik ke list produk dari mana saja
· \`batal\` — batalkan transaksi yang sedang pending

*FAQ*

*Pembayaran berhasil tapi produk belum terkirim?*
_Tunggu maks 3 menit. Jika belum, hubungi admin._

*Kode variant ada di mana?*
_Di list produk / \`.stok\`, tertulis setelah harga._

*Bisa ganti jumlah setelah pilih variasi?*
_Bisa. Di halaman pesanan ketik \`3\`, lalu masukkan jumlah baru._

*Saldo cukup tapi tidak bisa bayar?*
_Cek apakah ada transaksi pending. Ketik \`batal\` dulu, baru order ulang._

*Bisa membatalkan pesanan?*
_Bisa. Ketik \`batal\` saat halaman pesanan / pembayaran._

*Waktu pembayaran habis?*
_Pesanan auto-batal dan stok dikembalikan. Order ulang saja._

_Bantuan lain? Hubungi admin._`;

        await ctx.reply(helpMessage);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan saat memuat panduan.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in command/publicCommand/help.js: ${err.message}`));
    }
};

module.exports = helpCommand;
