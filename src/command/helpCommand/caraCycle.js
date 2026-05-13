const { isAdmin } = require('../../utils/checkRole');

const caraCycle = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Panduan Fitur Stock Cycle*

*Apa itu Stock Cycle?*
Fitur ini memungkinkan credentials (akun/password) dikembalikan secara otomatis ke pool stok setelah masa berlaku habis.

Contoh: Customer beli Netflix 1 Hari. Setelah 1 hari, akun Netflix tersebut otomatis kembali ke stok dan bisa dijual ke customer berikutnya.

*Langkah Setup Variant Cyclable*

1. *Aktifkan cycle di variant:*
\`.setcyclable <codeVariant> on\`
Contoh: \`.setcyclable netflix1h on\`

2. *Set durasi (berapa hari):*
\`.setcycleduration <codeVariant> <hari>\`
Contoh: \`.setcycleduration netflix1h 1\`
(artinya: 1 hari setelah beli, credentials dikembalikan)

3. *Cek sudah benar:*
Setelah order paid, bot otomatis menandai kapan credentials bisa disiklus.

*Monitoring*

\`.rekapcycle\` — Ringkasan harian + daftar order pending
Tampilkan: selesai, segera disiklus, terlambat (perlu perhatian), detail per order

\`.rekapcycle <codeVariant>\` — Filter per variant tertentu
Contoh: \`.rekapcycle net7d\` — hanya tampilkan cycle untuk variant net7d

\`.ceksiklus <transactionId>\` — Status cycle 1 order
Contoh: \`.ceksiklus INV-260228001\`
Tampilkan status setiap item dalam order tersebut

*Cycle Manual*

\`.cycle <transactionId>\` — Cycle manual 1 order
Contoh: \`.cycle INV-260228001\`
Tampil preview item, lalu ketik *ya* untuk konfirmasi. Gunakan jika 1 order spesifik perlu disiklus.

\`.cyclebulk\` — Cycle SEMUA order yang sudah jatuh tempo sekaligus
Tampil preview semua order pending, lalu ketik *ya* untuk konfirmasi.
Gunakan saat banyak order perlu disiklus sekaligus (misalnya pagi hari cek rutin).

Cycle otomatis dijalankan oleh sistem backend setiap jam.
Jika ada item yang gagal diretry 3x oleh backend, perlu intervensi manual via \`.cycle\`.

*Tips*

• Gunakan \`.rekapcycle\` setiap pagi untuk cek status dan lihat daftar pending
• Jika ada banyak order pending, langsung \`.cyclebulk\` untuk selesaikan sekaligus
• Jika ada item "perlu intervensi", cek dengan \`.ceksiklus\` lalu \`.cycle <txId>\`
• Cycle HANYA berjalan untuk variant yang \`is_cyclable = true\` DAN \`duration_days\` sudah diset

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraCycle;
