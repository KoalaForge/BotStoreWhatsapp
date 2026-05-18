const clc = require('cli-color');
const moment = require('moment-timezone');

const DM_HELP = `*Panduan Order Lengkap*

Ada dua cara order — pilih yang paling cocok. Semua perintah cukup diketik di chat, tidak perlu tombol.

*1. Pintasan Cepat (Tercepat) ⚡*
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

*2. Step by Step (Pemula) 🪜*

*2.1 Mulai Belanja*
Ketik salah satu:
· \`menu\` — buka katalog produk
· \`.stok\` — lihat stok lengkap
· \`halo\` / \`hai\` — buka halaman awal
Bot akan tampilkan list produk bernomor.

*2.2 Pilih Produk*
Ketik *nomor produk* dari list (contoh: \`1\`).
Bot tampilkan variasi (varian) + harga + stok + jumlah terjual.

*2.3 Pilih Variasi*
Ketik *nomor variasi* yang diinginkan.
Bot masuk ke *Halaman Pesanan*.

*2.4 Halaman Pesanan — Menu Aksi*
Di halaman pesanan, ketik angka:
· \`1\` — Bayar QRIS
· \`2\` — Bayar Saldo
· \`3\` — Ubah Jumlah pesanan
· \`4\` — Pakai / Hapus Voucher
· \`5\` — Tambah Catatan Pembeli
· \`0\` — Kembali ke variasi

*3. Pembayaran QRIS*
· Scan QR yang dikirim bot
· Transfer *persis* nominal yang tertera (jangan kurang/lebih)
· Batas waktu: *6 menit*
· Menit ke-5: bot kirim reminder
· Menit ke-6: pesanan auto-batal & stok dikembalikan
· Setelah bayar, tunggu 1–3 menit — produk dikirim otomatis

*4. Pembayaran Saldo*
· Cek saldo dulu via \`.saldo\`
· Pilih \`2\` di halaman pesanan
· Konfirmasi dengan \`1\` (atau \`2\` untuk batal)
· Produk langsung dikirim otomatis

*5. Top-up Saldo*
Ketik \`.saldo\` lalu pilih:
· \`1\` Rp10.000  · \`2\` Rp25.000
· \`3\` Rp50.000  · \`4\` Rp100.000
· \`5\` Custom (Rp5.000 – Rp10.000.000)
Atau ketik nominal langsung (min 5.000).

*6. Voucher Diskon*
Dua cara pakai voucher:
· Di halaman pesanan ketik \`4\`
· Atau ketik \`voucher\` lalu masukkan kode
Lihat voucher tersedia: \`.vouchers\`

*7. Riwayat Transaksi*
· \`riwayat\` — ringkasan
· \`riwayat pembelian\` — daftar pembelian
· \`riwayat deposit\` — daftar top-up
· Tambah \` semua\` untuk export full (contoh: \`riwayat pembelian semua\`)

*8. Navigasi & Pembatalan*
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

const GROUP_HELP = `*Panduan Order — Grup*

Di grup, hanya pintasan dot-command + quote-reply ke catalog yang aktif. Aksi lain dilanjutkan di DM bot.

*1. Pintasan Cepat (Tercepat) ⚡*
Kalau sudah tahu kode variant — bayar langsung:
· \`.buy <kode> <qty>\` — bayar QRIS
· \`.buynow <kode> <qty>\` — bayar Saldo

Contoh:
· \`.buy NETFLIX1B 1\` — beli 1 pcs via QRIS
· \`.buynow NETFLIX1B 3\` — beli 3 pcs via Saldo

_Lihat kode di_ \`.stok\` _atau_ \`.list\`.

*2. Step by Step via Catalog 🪜*

*2.1* Ketik \`.list\` (atau \`.stok\`) — bot kirim katalog dengan nomor produk.
*2.2* *Reply (quote)* pesan katalog itu dengan *nomor produk* (mis. \`1\`).
*2.3* Bot kirim daftar variant ke *DM kamu*. Lanjut order via DM.

_Reply harus quote pesan_ \`.list\` _dari bot — kalau bukan quote, nomor diabaikan._

*3. Pembayaran QRIS*
· Scan QR yang dikirim bot
· Transfer *persis* nominal yang tertera (jangan kurang/lebih)
· Batas waktu: *6 menit*
· Menit ke-5: bot kirim reminder
· Menit ke-6: pesanan auto-batal & stok dikembalikan
· Setelah bayar, tunggu 1–3 menit — produk dikirim otomatis

*4. Pembayaran Saldo*
· Cek saldo: \`.saldo\`
· Bayar langsung: \`.buynow <kode> <qty>\` — saldo dipotong, produk dikirim otomatis

*5. Top-up Saldo*
Ketik \`.topup <nominal>\` (min Rp 5.000, maks Rp 10.000.000).
Contoh: \`.topup 50000\`.
_QR top-up dikirim ke *DM kamu*._

*6. Lanjutan di DM*
Fitur ini hanya tersedia via DM bot:
· Voucher diskon
· Riwayat transaksi
· Batal transaksi pending
· Ubah jumlah dari halaman pesanan
· Catatan pembeli
· Navigasi \`menu\` / \`kembali\`

_Buka DM bot lalu ketik_ \`cara order\` _untuk panduan lengkap._

*FAQ*

*Pembayaran berhasil tapi produk belum terkirim?*
_Tunggu maks 3 menit. Belum sampai? Hubungi admin._

*Kode variant ada di mana?*
_Di_ \`.list\` _/_ \`.stok\`_, tertulis setelah harga._

*Reply nomor di grup tidak respon?*
_Pastikan kamu *quote* pesan_ \`.list\` _terbaru dari bot, bukan kirim angka biasa._

*Mau pakai voucher / lihat riwayat / batal?*
_Lanjut di DM bot._

_Bantuan lain? Hubungi admin._`;

const helpCommand = async (ctx) => {
    try {
        const helpMessage = ctx.isGroup ? GROUP_HELP : DM_HELP;
        await ctx.reply(helpMessage);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan saat memuat panduan.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in command/publicCommand/help.js: ${err.message}`));
    }
};

module.exports = helpCommand;
