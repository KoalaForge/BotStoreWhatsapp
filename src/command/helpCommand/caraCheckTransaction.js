const { isAdmin } = require('../../utils/checkRole');

const caraCheckTransaction = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Check Transaction*

*Fungsi:* Melihat detail lengkap transaksi berdasarkan Transaction ID

*Format Command:*
\`.checktransaction [TRANSACTION_ID]\`

*Contoh Penggunaan:*
\`.checktransaction TRX123456789\`
\`.checktransaction TOPUP987654321\`

*Keterangan:*
• TRANSACTION_ID: ID transaksi yang ingin dicek
• Command ini menampilkan informasi super detail dari sebuah transaksi

*Informasi yang Ditampilkan*

*Informasi Dasar:*
Transaction ID, Type transaksi, Metode pembayaran, Status lengkap, Tanggal

*Informasi Customer:*
User ID, Chat ID dan Message ID

*Informasi Produk:* (untuk transaksi product)
Kode produk, Variant, Jumlah order

*Informasi Keuangan:*
Total harga, Fee/Tax, Profit, Voucher dan diskon

*Order Data:*
Data lengkap orderan yang diterima customer

*Timeline:*
Waktu dibuat, Waktu update, Durasi transaksi

*Kegunaan*

• Debugging transaksi bermasalah
• Verifikasi detail orderan customer
• Tracking profit per transaksi
• Audit trail transaksi

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraCheckTransaction;
