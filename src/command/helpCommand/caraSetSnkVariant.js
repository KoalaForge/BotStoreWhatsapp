const { isAdmin } = require('../../utils/checkRole');

const caraSetSnkVariant = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set SnK Varian Produk*

SnK (Syarat & Ketentuan) terdiri dari 2 bagian:
1. *Syarat & Ketentuan* - Aturan penggunaan produk
2. *Ketentuan Garansi* - Informasi garansi (opsional)

*Cara Set*

1. Kirim command:
\`.setvariantsnk <kode_varian>\`

2. Bot akan meminta *Syarat & Ketentuan*
   → Kirim teks Syarat & Ketentuan

3. Bot akan meminta *Ketentuan Garansi*
   → Kirim teks garansi ATAU ketik \`.skip\`

4. Selesai! SnK tersimpan.

*Contoh*

*Command:*
\`.setvariantsnk NETFLIX-1B\`

*Bot minta T&C, kirim:*
1 Profil = 1 Device
Dilarang sharing akun
*Penting:* jangan ganti password
> Termasuk email dan PIN

*Bot minta Garansi, kirim:*
Garansi 1 bulan
> Klaim via admin
Support 24 jam

*Atau ketik:*
\`.skip\` (jika tidak ada garansi)

*Format Penulisan*

• Setiap baris baru = poin baru (•)
• \`>\` di awal baris = sub-poin
• \`*teks*\` = *tebal*
• \`_teks_\` = _miring_

*Tips*

• Maksimal T&C: 2000 karakter
• Maksimal Garansi: 1000 karakter
• Ketik \`.cancel\` kapan saja untuk batal

*Menghapus SnK*

\`.delvariantsnk <kode_varian>\`
*Contoh:* \`.delvariantsnk NETFLIX-1B\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetSnkVariant;
