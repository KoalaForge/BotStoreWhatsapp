const { renderSuggestionGroups } = require('./menuFormatter');

const BASE_MESSAGE = 'Produk tidak ditemukan.';

function formatNotFoundReply(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return BASE_MESSAGE;
    }

    const { blocks, firstCode } = renderSuggestionGroups(suggestions);
    if (blocks.length === 0) return BASE_MESSAGE;

    const exampleCode = firstCode || '<kode>';
    const lines = [
        BASE_MESSAGE,
        '',
        'Mungkin yang kamu cari:',
        '',
        blocks.join('\n\n'),
        '',
        '🛍 *PANDUAN ORDER:*',
        '* QRIS  : `.buy <kode> <jumlah>`',
        '* Saldo : `.buynow <kode> <jumlah>`',
        `_Contoh:_ \`.buy ${exampleCode} 1\``
    ];

    return lines.join('\n');
}

module.exports = { formatNotFoundReply };
