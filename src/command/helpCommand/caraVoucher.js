const caraVoucher = async (ctx) => {
    try {
        const text = `*Panduan Voucher*

*Membuat Voucher*

*Format:*
\`.addvoucher CODE TYPE VALUE MAXUSES MAXDISC MINORDER DESC START END\`

*Parameter:*
• CODE: Kode voucher (uppercase)
• TYPE: fixed atau percentage
• VALUE: Nominal atau persen
• MAXUSES: Batas penggunaan (0 = unlimited)
• MAXDISC: Cap diskon max (opsional)
• MINORDER: Min pembelian (opsional)
• DESC: Deskripsi dalam quotes (opsional)
• START: Tanggal mulai YYYY-MM-DD (opsional)
• END: Tanggal berakhir YYYY-MM-DD (opsional)

*Contoh Fixed:*
\`.addvoucher NEWUSER fixed 50000 50 0 0 "Diskon User Baru"\`

*Contoh Percentage:*
\`.addvoucher SUMMER2024 percentage 10 100 5000 100000 "Diskon Summer" 2025-06-01 2025-08-31\`

*Operasi Voucher*

\`.listvoucher\` — Melihat semua voucher
\`.delvoucher SUMMER2024\` — Menghapus voucher
\`.activatevoucher SUMMER2024\` — Mengaktifkan voucher
\`.deactivatevoucher SUMMER2024\` — Menonaktifkan voucher

*Tips*

• Gunakan kode voucher yang mudah diingat
• Set tanggal berakhir untuk campaign terbatas
• Gunakan cap diskon max untuk kontrol budget
• Monitor penggunaan dengan \`.voucher\`
• Nonaktifkan voucher yang sudah tidak berlaku

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraVoucher;
