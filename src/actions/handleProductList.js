const productRepository = require("../repositories/ProductRepository");
const moment = require("moment-timezone");
const clc = require('cli-color');
const { getStockTerjualBatch } = require("../utils/stockUtils");
const { buildVariantItems } = require("../utils/variantDisplayHelper");
const { formatCurrency } = require("../utils/waFormatter");
const screenState = require('../state/screenState');

/**
 * Extract product selector from callback data or message text.
 * Returns { kind: 'code'|'index', value } or null.
 *   - Callback `prod:<code>` → fetch by exact product code (preferred).
 *   - Numeric text → fall back to position-based lookup.
 */
function extractProductSelector(ctx) {
    if (ctx.callbackData) {
        const codeMatch = ctx.callbackData.match(/^prod:(.+)$/);
        if (codeMatch) return { kind: 'code', value: codeMatch[1] };
        const legacy = ctx.callbackData.match(/^product_(\d+)$/);
        if (legacy) return { kind: 'index', value: legacy[1] };
    }
    if (ctx.message && /^\d+$/.test(ctx.message.trim())) {
        return { kind: 'index', value: ctx.message.trim() };
    }
    return null;
}

async function handleProductList(ctx) {
    try {
        const selector = extractProductSelector(ctx);
        if (!selector) return;

        let getProduct;
        if (selector.kind === 'code') {
            getProduct = await productRepository.findByCode(ctx, selector.value);
        } else {
            const products = await productRepository.findActiveProducts(ctx, {
                sort: { name: 1 },
                skip: parseInt(selector.value, 10) - 1,
                limit: 1
            });
            getProduct = products[0];
        }
        if (!getProduct) return;

        const ownerId = ctx.repositoryContext?.ownerId;

        const variantItems = await buildVariantItems(ctx, getProduct, ownerId);

        if (variantItems.length === 0) {
            return ctx.reply('*Variasi belum tersedia untuk produk ini.*\n\nKetik `list` untuk kembali ke daftar produk.');
        }

        // Load sold stock in parallel
        const variantCodes = variantItems.map(item => item.code);
        const soldMap = await getStockTerjualBatch(ctx, variantCodes);
        const totalSoldStock = variantItems.reduce((sum, item) => sum + (soldMap.get(item.code) || 0), 0);

        // Build message text with WhatsApp markdown
        let text = "";
        text += `*${getProduct.name}*\n`;
        if (getProduct.description) {
            text += `_"${getProduct.description}"_\n`;
        }
        text += `\nTerjual ${totalSoldStock} pcs\n`;
        text += `\n> Diperbarui pada ${moment().format('HH:mm:ss')} WIB\n`;

        // Numbered detail list kept inside body — backward compat for clients
        // that don't render nativeFlow lists, plus context for the picker rows.
        text += '\n';
        variantItems.forEach((item, i) => {
            text += `*${i + 1}.* ${item.name} · ${formatCurrency(item.price)} · ${item.stock} stok\n`;
        });

        const userId = ctx.from;
        screenState.setScreen(userId, 'VARIANT_SELECT', {
            variantItems,
            productCode: getProduct.code
        });

        await ctx.reply(`${text}\n_Ketik nomor variasi untuk memilih._\n_Ketik *0* atau *kembali* untuk kembali._`);
    } catch (err) {
        console.log(err);
        ctx.reply("*Terjadi kesalahan, silakan coba lagi.*");
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in handleProductList: ${err.message}`));
    }
}

module.exports = handleProductList;
