const { formatMoney } = require('../database/models/money');

function renderWelcomeHeader(phoneNumber, companyName, greeting) {
    return [
        `Halo ka, @${phoneNumber}! 👋`,
        `${greeting.text} ${greeting.emoji}`,
        '',
        `Selamat datang di *${companyName}* 🚀`
    ].join('\n');
}

function renderSectionBlock(title, bodyLines, opts = {}) {
    const open = opts.openDivider ?? '──────';
    const close = opts.closeDivider ?? '───────────────────── ';
    const header = `${open} [ ${title} ] ${open}`;
    return [header, ...bodyLines.map(l => `  ${l}`), close].join('\n');
}

function renderPanduanBlock(isGroup = false) {
    const lines = isGroup
        ? [
            'QRIS  : .buy <kode> <jumlah>',
            'Saldo : .buynow <kode> <jumlah>'
        ]
        : [
            'QRIS  : buy <kode> <jumlah>',
            'Saldo : buynow <kode> <jumlah>'
        ];
    return renderSectionBlock('🛒 PANDUAN ORDER', lines, { openDivider: '──', closeDivider: '──' });
}

function renderPintasanBlock(isGroup = false) {
    const lines = isGroup
        ? [
            '.stok       : Lihat stok lengkap',
            '.saldo      : Cek & top-up saldo',
            '.caraorder  : Panduan lengkap'
        ]
        : [
            '.stok       : Lihat stok lengkap',
            '.saldo      : Cek & top-up saldo',
            '.vouchers   : Lihat voucher',
            'riwayat     : Riwayat transaksi',
            'cara order  : Panduan lengkap'
        ];
    return renderSectionBlock('⚡ PINTASAN', lines);
}

function renderVariantCard({ productIndex, productName, variant, soldCount }) {
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
    const title = productIndex
        ? `#${productIndex} · ${productName} — ${variant.name}`
        : `${productName} — ${variant.name}`;
    return renderSectionBlock(title, body);
}

module.exports = {
    renderWelcomeHeader,
    renderSectionBlock,
    renderPanduanBlock,
    renderPintasanBlock,
    renderVariantCard
};
