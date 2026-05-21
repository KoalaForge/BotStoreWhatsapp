const { formatMoney } = require('../database/models/money');

const BASE_MESSAGE = 'Produk tidak ditemukan.';

function _priceLabel(price) {
    if (typeof price !== 'number' || !isFinite(price) || price <= 0) return '-';
    return formatMoney(price);
}

function formatNotFoundReply(suggestions, opts = {}) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return BASE_MESSAGE;
    }

    const lines = [BASE_MESSAGE, '', 'Mungkin yang kamu cari:'];
    let firstCode = null;
    for (const v of suggestions) {
        const productName = v.productName ? String(v.productName).toUpperCase() : null;
        const variantName = v.name || '-';
        const code = v.codeVariant || '-';
        const price = _priceLabel(v.price);
        if (!firstCode) firstCode = code;

        if (productName) {
            lines.push(`• *${productName}* — ${variantName} — \`${code}\` — ${price}`);
        } else {
            lines.push(`• ${variantName} — \`${code}\` — ${price}`);
        }
    }

    const exampleCode = firstCode || '<kode>';
    lines.push('');
    lines.push('🛍 *PANDUAN ORDER:*');
    lines.push('* QRIS  : `.buy <kode> <jumlah>`');
    lines.push('* Saldo : `.buynow <kode> <jumlah>`');
    lines.push(`_Contoh:_ \`.buy ${exampleCode} 1\``);

    return lines.join('\n');
}

module.exports = { formatNotFoundReply };
