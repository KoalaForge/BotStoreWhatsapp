const { formatMoney } = require('../database/models/money');

const MAX_WA_CHARS = 3800;

function renderWelcomeHeader(displayName, companyName, greeting) {
    return [
        `Halo ka, @${displayName}! 👋`,
        `${greeting.text} ${greeting.emoji}`,
        '',
        `Selamat datang di *${companyName}* 🚀`
    ].join('\n');
}

function renderSectionBlock(title, bodyLines) {
    const header = `─── [ ${title} ] ───`;
    const closing = '─'.repeat([...header].length);
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

function chunkMessage(fullText) {
    if (fullText.length <= MAX_WA_CHARS) return [fullText];
    const lines = fullText.split('\n');
    const chunks = [];
    let buf = '';
    for (const line of lines) {
        if ((buf + '\n' + line).length > MAX_WA_CHARS && buf) {
            chunks.push(buf);
            buf = line;
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
    chunkMessage
};
