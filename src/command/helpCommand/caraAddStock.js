const { isAdmin } = require('../../utils/checkRole');

const caraAddStock = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Stock*

1. Kirim \`.addstock <code_variant> <modal>\` (atau \`.addstok\`)
2. Setelah bot membalas, kirim data stock nya (satu per baris)

*Contoh:* \`.addstock net1b 5000\`

*Modal* adalah harga beli per unit, *bukan profit*.
• Wajib diisi, angka bulat minimal 0, tanpa titik atau "k"
• Isi 0 untuk stok gratis atau bonus
• Profit dihitung otomatis: harga jual - modal
• Bot membalas "Modal Rp X → profit Rp Y/unit", atau "rugi Rp X/unit" bila modal melebihi harga jual. Cek angkanya sebelum mengirim data stock.

Jika ingin membuat stok menjadi

Account 1
📧 | Email: xxx.com
🔓 | Password: black66
👤 | Profile: D - KOALA (❗LOGIN 1 DEVICE❗)
🔢 | PIN: 0004

Account 2
📧 | Email: xxx.com
🔓 | Password: black66
👤 | Profile: E - KOALA (❗LOGIN 1 DEVICE❗)
🔢 | PIN: 0005

saat pembelian silahkan gunakan format ini saat membuat stock:
\`📧 | Email: xxx.com,🔓 | Password: 123,👤 | Profile: A,🔢 | PIN: 001\`

tandai dengan \`*\` untuk tanda sebagai baris baru saat distribusi akun.

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraAddStock;
