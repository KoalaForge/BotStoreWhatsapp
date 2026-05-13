const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');

/**
 * Add a product variant
 * Usage: .addvariant <productCode> <variantName> <price>
 *
 * The variant code is auto-generated: PRODUCTCODE-VARIANTNAME
 */
const addProductVariant = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];

        if (args.length < 3) {
            return ctx.reply(
                '*Tambah Variant Produk*\n\n' +
                'Format:\n' +
                '`.addvariant <productCode> <namaVariant> <harga>`\n\n' +
                'Contoh:\n' +
                '`.addvariant CANVA 1Bulan 50000`\n\n' +
                'Code variant akan otomatis dibuat: CANVA-1Bulan'
            );
        }

        const productCode = args[0].toUpperCase();
        const variantName = args[1];
        const price = parseInt(args[2]);

        if (isNaN(price)) {
            return ctx.reply('*Harga harus berupa angka!*');
        }

        const checkProduct = await productRepository.findByCode(ctx, productCode);
        if (!checkProduct) {
            return ctx.reply('*Code produk tidak ditemukan.*');
        }

        const codeVariant = `${productCode}-${variantName}`;

        const existingVariant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (existingVariant) {
            return ctx.reply(`*Variant \`${codeVariant}\` sudah ada!*`);
        }

        await productVariantRepository.create(ctx, {
            name: variantName,
            code: productCode,
            codeVariant: codeVariant,
            descriptionVariant: '',
            price: price,
            keteranganVariant: '',
            isActive: true,
        });

        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Successfully add new variant ${codeVariant}`));
        await ctx.reply(
            `*Variant produk berhasil ditambahkan*\n\n` +
            `Code Variant: \`${codeVariant}\`\n` +
            `Nama: ${variantName}\n` +
            `Harga: Rp ${price.toLocaleString('id-ID')}`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in addProductVariant.js: ${err.message}`));
    }
};

module.exports = addProductVariant;
