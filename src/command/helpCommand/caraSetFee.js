const { isAdmin } = require('../../utils/checkRole');

const caraSetFee = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Set Fee Payment Gateway*

*Fungsi:* Mengatur siapa yang menanggung biaya payment gateway (QRIS)

*Format Command:*
\`.setfee [customer|merchant]\`

*Pilihan:*
• \`customer\` - Customer menanggung biaya gateway
• \`merchant\` - Merchant menanggung biaya gateway

*Contoh Penggunaan:*
\`.setfee customer\`
\`.setfee merchant\`

*Penjelasan Detail*

*1. Customer menanggung biaya (default):*
• Harga produk: Rp 10,000
• Fee gateway (1.7%): Rp 170
• *Total yang dibayar customer: Rp 10,170*

*2. Merchant menanggung biaya:*
• Harga produk: Rp 10,000
• Fee gateway (1.7%): Rp 170
• *Total yang dibayar customer: Rp 10,000*
• Merchant yang menanggung Rp 170

*Catatan:*
• Fee selalu tercatat di database untuk laporan
• Pengaturan berlaku untuk transaksi berikutnya
• Tidak mempengaruhi transaksi yang sudah ada

_Ketik \`.setfee\` tanpa parameter untuk melihat pengaturan aktif_

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraSetFee;
