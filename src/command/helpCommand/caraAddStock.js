const { isAdmin } = require('../../utils/checkRole');

const caraAddStock = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Add Stock*

Kalian tinggal kirim data stock nya dengan command dan reply data stock nya.

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
