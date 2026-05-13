const moment = require('moment-timezone');
const productRepository = require('../repositories/ProductRepository');
const { getStockTerjualBatch } = require('../utils/stockUtils');
const { buildVariantItems } = require('../utils/variantDisplayHelper');
const { formatCurrency } = require('../utils/waFormatter');
const screenState = require('../state/screenState');

/**
 * Handle variant list refresh in WhatsApp.
 *
 * Triggered by:
 *   - Callback: "refresh-list-{code}" or "back-to-variant-{code}"
 *   - Text: "refresh {code}"
 *
 * Re-sends the variant list for the given product code.
 */
async function handleProductVariantRefresh(ctx) {
    let productCode = null;

    // From callback data
    if (ctx.callbackData) {
        const refreshMatch = ctx.callbackData.match(/^refresh-list-(.+)$/);
        const backMatch = ctx.callbackData.match(/^back-to-variant-(.+)$/);
        if (refreshMatch) productCode = refreshMatch[1];
        else if (backMatch) productCode = backMatch[1];
    }

    // From text input: "refresh CODE"
    if (!productCode && ctx.match) {
        productCode = ctx.match[1];
    }

    if (!productCode) return;

    const getProduct = await productRepository.findByCode(ctx, productCode);
    if (!getProduct) return;

    const ownerId = ctx.repositoryContext?.ownerId;
    const variantItems = await buildVariantItems(ctx, getProduct, ownerId);

    if (variantItems.length === 0) {
        return ctx.reply('*Variasi belum tersedia untuk produk ini.*\n\nKetik `list` untuk kembali ke daftar produk.');
    }

    // Calculate total sold stock
    const variantCodes = variantItems.map(item => item.code);
    const soldMap = await getStockTerjualBatch(ctx, variantCodes);
    const totalSoldStock = variantItems.reduce((sum, item) => sum + (soldMap.get(item.code) || 0), 0);

    let text = "";
    text += `*${getProduct.name}*\n`;
    if (getProduct.description) {
        text += `_"${getProduct.description}"_\n`;
    }
    text += `\nTerjual ${totalSoldStock} pcs\n`;
    text += `\n> Diperbarui pada ${moment().format('HH:mm:ss')} WIB\n`;

    text += '\n';
    variantItems.forEach((item, i) => {
        text += `*${i + 1}.* ${item.name} · ${formatCurrency(item.price)} · ${item.stock} stok\n`;
        if (item.tierHint) {
            text += `   _📦 Grosir mulai ${item.tierHint.minQty} pcs · ${formatCurrency(item.tierHint.tierUnitPrice)}/pcs_\n`;
        }
    });

    const userId = ctx.from;
    screenState.setScreen(userId, 'VARIANT_SELECT', {
        variantItems,
        productCode: getProduct.code
    });

    await ctx.reply(`${text}\n_Ketik nomor variasi untuk memilih._\n_Ketik *0* atau *kembali* untuk kembali._`);
}

module.exports = handleProductVariantRefresh;
