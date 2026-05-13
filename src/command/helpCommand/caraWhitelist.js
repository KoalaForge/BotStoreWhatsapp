const moment = require('moment-timezone');
const clc = require('cli-color');
const { requireAdmin } = require('../../middleware/waAuth');

const caraWhitelist = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const text = `*Cara Pakai Whitelist*

Whitelist adalah pengaturan untuk membatasi siapa yang boleh memakai bot Anda. Berguna kalau bot dipakai oleh banyak orang dan Anda ingin menyaring user dulu.

*Status awal:* nonaktif. Tidak ada yang berubah sampai Anda menyalakan fitur ini.

*1. Menyalakan whitelist*

Ketik:
.togglewhitelist on

Setelah dinyalakan:
- Semua user yang sudah pernah pakai bot akan otomatis kembali ke status menunggu persetujuan.
- Setiap user baru yang menjalankan .start akan otomatis mengirim permintaan ke Anda.

*2. Menyetujui user yang menunggu*

Cek daftar pending dengan:
.listwhitelist

Akan muncul daftar user yang menunggu, lengkap dengan command yang siap disalin untuk masing-masing user. Tinggal salin atau ketik:

.approvewhitelist 6281234567890   (setujui)
.rejectwhitelist 6281234567890    (tolak)

User akan langsung dapat pemberitahuan otomatis dari bot.

*3. Notifikasi otomatis*

Setiap kali ada user baru menekan .start, Anda akan menerima pesan seperti ini:

_Permohonan Akses Baru
Nomor: 6281234567890
Nama: Budi
Permohonan ke: 1
Waktu: ..._

Pesan tersebut sudah berisi command .approvewhitelist dan .rejectwhitelist yang tinggal Anda salin.

*4. User yang ditolak*

Kalau Anda menolak, user dapat pesan bahwa permintaannya tidak disetujui dan baru bisa coba lagi setelah *24 jam*. Sebelum 24 jam, mereka tidak bisa kirim permintaan baru.

*5. Cek riwayat*

.listwhitelist                — yang sedang menunggu
.listwhitelist approved       — yang sudah disetujui
.listwhitelist rejected       — yang ditolak

Setiap halaman menampilkan 10 user. Untuk halaman lain:
.listwhitelist pending 2

*6. Mematikan whitelist*

.togglewhitelist off

Setelah dimatikan, semua user kembali bisa pakai bot tanpa perlu disetujui. Status user (disetujui / ditolak) tetap tersimpan, jadi kalau Anda nyalakan lagi nanti, riwayatnya tidak hilang — tapi semua user akan kembali ke status menunggu lagi.

*Catatan*

- Admin bot tidak ikut tersaring. Anda dan tim admin selalu bisa pakai bot, dengan whitelist menyala atau tidak.
- User yang sudah Anda blokir lewat .banned tetap terblokir, terlepas dari whitelist.
- Whitelist hanya berlaku untuk chat pribadi (DM), tidak untuk grup.`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('*Terjadi error saat menjalankan command.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`caraWhitelist: ${err.message}`)
        );
    }
};

module.exports = caraWhitelist;
