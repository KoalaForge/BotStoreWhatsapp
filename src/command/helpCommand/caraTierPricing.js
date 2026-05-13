const { isAdmin } = require('../../utils/checkRole');

const caraTierPricing = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Tier Pricing (Harga Grosir)*

Tier pricing memungkinkan harga otomatis turun saat pembeli memesan dalam jumlah tertentu.

*Tambah tier:*
\`.addtierpricing <codeVariant> <minQty> <harga>\`
Contoh: \`.addtierpricing CANVA-1Bulan 5 45000\`

*Hapus satu tier:*
\`.deltierpricing <codeVariant> <minQty>\`
Contoh: \`.deltierpricing CANVA-1Bulan 5\`

*Lihat semua tier:*
\`.listtierpricing <codeVariant>\`

*Hapus semua tier:*
\`.cleartierpricing <codeVariant>\`

_minQty minimal 2. Harga tier akan aktif otomatis saat pembeli memenuhi kuantitas minimum._

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraTierPricing;
