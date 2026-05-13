const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Add a new product
 * Usage: .addproduct <code> <name> <description>
 */
const addProduct = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 3) {
            return ctx.reply(
                '*Tambah Produk*\n\n' +
                'Format:\n' +
                '`.addproduct <code> <nama> <deskripsi>`\n\n' +
                'Contoh:\n' +
                '`.addproduct CANVA Canva Premium Akun Canva Premium 1 Bulan`'
            );
        }

        const codeProduct = args[0].toUpperCase();
        const nameProduct = args[1];
        const deskripsiProduct = args.slice(2).join(' ');

        const existingProduct = await productRepository.findByCode(ctx, codeProduct);
        if (existingProduct) {
            return ctx.reply('*Code product sudah digunakan, gunakan code yang lain!*');
        }

        await productRepository.create(ctx, {
            name: nameProduct,
            description: deskripsiProduct,
            code: codeProduct,
            isActive: true,
        });

        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Successfully add new product ${nameProduct}`));
        await ctx.reply(`*Produk berhasil ditambahkan*\n\nCode: \`${codeProduct}\`\nNama: ${nameProduct}\nDeskripsi: ${deskripsiProduct}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in addProduct.js: ${err.message}`));
    }
};

module.exports = addProduct;
