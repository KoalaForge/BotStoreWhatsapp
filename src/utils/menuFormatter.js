const { formatMoney } = require('../database/models/money');

const MAX_WA_TEXT = 3800;     // text-only message safe limit (vs 65536 hard cap)
const MAX_WA_CAPTION = 1024;  // image caption hard limit

function renderWelcomeHeader(displayName, companyName, greeting) {
    return [
        `Halo ka, @${displayName}! 👋`,
        `${greeting.text} ${greeting.emoji}`,
        '',
        `Selamat datang di *${companyName}* 🚀`
    ].join('\n');
}

function renderSectionBlock(title, bodyLines) {
    const header = `────── [ ${title} ] ──────`;
    const closing = '───────────────────── '.repeat([...header].length);
    return [header, ...bodyLines.map(l => `  ${l}`), closing].join('\n');
}

function renderPanduanBlock() {
    return renderSectionBlock('🛒 PANDUAN ORDER', [
        'QRIS  : buy <kode> <jumlah>',
        'Saldo : buynow <kode> <jumlah>'
    ]);
}

function renderPintasanBlock() {
    return renderSectionBlock('⚡ PINTASAN', [
        '.stok       : Lihat stok lengkap',
        '.saldo      : Cek & top-up saldo',
        '.vouchers   : Lihat voucher',
        'riwayat     : Riwayat transaksi',
        'cara order  : Panduan lengkap'
    ]);
}

function renderVariantCard({ productName, variant, soldCount }) {
    const stockText = variant.stock > 0 ? String(variant.stock) : 'HABIS ❌';
    const body = [
        `💵 | Harga     : ${formatMoney(variant.price)}`,
        `📦 | Stok      : ${stockText}`,
        `🔥 | Terjual   : ${soldCount}`
    ];
    if (variant.tierHint) {
        body.push(`📥 | Bulk      : min ${variant.tierHint.minQty} pcs · ${formatMoney(variant.tierHint.tierUnitPrice)}/pcs`);
    }
    body.push(`🔐 | Kode      : \`${variant.code}\``);
    if (variant.description) {
        body.push(`📝 | Deskripsi : ${variant.description}`);
    }
    return renderSectionBlock(`${productName} — ${variant.name}`, body);
}

function chunkMessage(fullText, firstMax = MAX_WA_TEXT, restMax = MAX_WA_TEXT) {
    if (fullText.length <= firstMax) return [fullText];
    const lines = fullText.split('\n');
    const chunks = [];
    let buf = '';
    let limit = firstMax;
    for (const line of lines) {
        if ((buf + '\n' + line).length > limit && buf) {
            chunks.push(buf);
            buf = line;
            limit = restMax;
        } else {
            buf = buf ? `${buf}\n${line}` : line;
        }
    }
    if (buf) chunks.push(buf);
    return chunks;
}

module.exports = {
    renderWelcomeHeader,
    renderSectionBlock,
    renderPanduanBlock,
    renderPintasanBlock,
    renderVariantCard,
    chunkMessage,
    MAX_WA_TEXT,
    MAX_WA_CAPTION
};
