const moment = require('moment-timezone');
const clc = require('cli-color');
const { requireAdmin } = require('../../middleware/waAuth');

const caraVariantWhitelist = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const text = `*Cara Whitelist Variant / Produk*

Wajibkan approval admin sebelum user bisa buka/beli produk atau variant tertentu. Berlaku HANYA untuk produk/variant yang Anda tandai — tidak semua.

*Aktifkan (tandai target):*
.setproductwl <productCode> on   — seluruh variant produk wajib approval
.setvariantwl <codeVariant> on   — hanya variant itu
Matikan dengan off.

*Alur:*
1. User buka produk/variant yang ditandai → admin dapat pesan berisi command .approveproduct / .approvevariant siap-salin
2. Approve → user bisa buka + beli
3. Reject → user baru bisa minta lagi setelah 24 jam

*Approve/Reject via command:*
.approveproduct <productCode> <nomor>
.rejectproduct <productCode> <nomor>
.approvevariant <codeVariant> <nomor>   (hanya 1 variant)
.rejectvariant <codeVariant> <nomor>

*Lihat permohonan:*
.listproductwl <productCode> [pending|approved|rejected]
.listvariantwl <codeVariant> [pending|approved|rejected]

*Inti:*
- Whitelist = daftar-izin + approval (kebalikan dari ban).
- Aktif HANYA untuk produk/variant yang Anda .setproductwl atau .setvariantwl — bukan semua. Tidak ada toggle global.
- Scope request ikut yang ditandai: produk = buka semua variant; variant = 1 variant saja.
- Akses diberikan jika user approved di level variant ATAU produk.
- Reject = cooldown 24 jam sebelum bisa minta lagi.
- Ingin approve produk tapi blokir 1 variant? Approve produk lalu .banvariant variant itu.
- Admin selalu lolos. Bisa juga di-set dari web KOALA (toggle di editor produk/variant).`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('*Terjadi error saat menjalankan command.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`caraVariantWhitelist: ${err.message}`)
        );
    }
};

module.exports = caraVariantWhitelist;
