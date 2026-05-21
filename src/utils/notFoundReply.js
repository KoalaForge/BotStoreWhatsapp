const { formatMoney } = require('../database/models/money');

const BASE_MESSAGE = 'Produk tidak ditemukan.';

function formatNotFoundReply(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return BASE_MESSAGE;
    }
    const lines = [BASE_MESSAGE, '', 'Mungkin yang kamu cari:'];
    for (const v of suggestions) {
        const name = v.name || '-';
        const code = v.codeVariant || '-';
        const price = typeof v.price === 'number' ? formatMoney(v.price) : '-';
        lines.push(`• ${name} — \`${code}\` — ${price}`);
    }
    return lines.join('\n');
}

module.exports = { formatNotFoundReply };
