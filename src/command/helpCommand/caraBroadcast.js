const { isAdmin } = require('../../utils/checkRole');

const caraBroadcast = async (ctx) => {
    try {
        if (!await isAdmin(ctx.from, ctx)) return;

        const text = `*Cara Broadcast*

Cara broadcast cukup mudah hanya dengan reply pesan yang ingin dibroadcast dengan command \`.broadcast\`.

*Contoh:*
1. Tulis pesan yang ingin dibroadcast
2. Reply pesan tersebut dengan \`.broadcast\`

_Ketik .adminmenu untuk kembali_`;

        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('Terjadi error saat menjalankan command.');
    }
};

module.exports = caraBroadcast;
