const { renderSuggestionGroups } = require('./menuFormatter');

function formatAutoSuggestReply(suggestions, { mentionPhone = null } = {}) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

    const { blocks, firstCode } = renderSuggestionGroups(suggestions);
    if (blocks.length === 0) return null;

    const intro = mentionPhone
        ? `@${mentionPhone} sepertinya kamu mencari:`
        : 'Sepertinya kamu mencari:';

    const exampleCode = firstCode || '<kode>';
    const lines = [
        intro,
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

module.exports = { formatAutoSuggestReply };
