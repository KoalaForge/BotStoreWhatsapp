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

function renderCompactList(productsWithVariants, { mentionPhone = null } = {}) {
    const readyEntries = [];
    const habisEntries = [];

    for (const product of productsWithVariants) {
        const variants = product.variants || [];
        if (variants.length === 0) continue;
        const readyVariants = variants.filter(v => (v.stock || 0) > 0);
        if (readyVariants.length > 0) {
            readyEntries.push({ product, variants: readyVariants });
        } else {
            habisEntries.push({ product, variants });
        }
    }

    const readyBlocks = [];
    const habisBlocks = [];
    let firstReadyCode = null;
    let idx = 0;

    for (const { product, variants } of readyEntries) {
        idx += 1;
        const blockLines = [`📦 *#${idx} ${product.name.toUpperCase()}*`];
        for (const v of variants) {
            if (!firstReadyCode) firstReadyCode = v.code;
            blockLines.push(`* ${v.name.toUpperCase()} │ ${formatMoney(v.price)}`);
            blockLines.push(`    └ -Kode: \`${v.code}\``);
        }
        readyBlocks.push(blockLines.join('\n'));
    }

    for (const { product, variants } of habisEntries) {
        idx += 1;
        const blockLines = [`📦 *#${idx} ${product.name.toUpperCase()}* _(stok habis)_`];
        for (const v of variants) {
            blockLines.push(`* ~${v.name.toUpperCase()}~ │ ❌ HABIS`);
            blockLines.push(`    └ -Kode: \`${v.code}\``);
        }
        habisBlocks.push(blockLines.join('\n'));
    }

    if (readyBlocks.length === 0 && habisBlocks.length === 0) {
        return '*Belum ada produk tersedia*';
    }

    const exampleCode = firstReadyCode || '<kode>';
    const title = mentionPhone
        ? `@${mentionPhone} *Daftar Produk*`
        : '*Daftar Produk*';

    const lines = [
        title,
        '📊 Format: NAMA │ HARGA  •  Kode di subline',
        '',
        '🛍️ *PANDUAN ORDER:*',
        '* QRIS  : `.buy <kode> <jumlah>`',
        '* Saldo : `.buynow <kode> <jumlah>`',
        `_Contoh:_ \`.buy ${exampleCode} 1\``,
        ''
    ];

    if (readyBlocks.length > 0) {
        lines.push(readyBlocks.join('\n\n'));
    }

    if (habisBlocks.length > 0) {
        if (readyBlocks.length > 0) {
            lines.push('');
            lines.push('━━━━━ ❌ *STOK HABIS* ━━━━━');
            lines.push('');
        }
        lines.push(habisBlocks.join('\n\n'));
    }

    return lines.join('\n');
}

function _priceLabel(price) {
    if (typeof price !== 'number' || !isFinite(price) || price <= 0) return '-';
    return formatMoney(price);
}

function renderSuggestionGroups(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
        return { blocks: [], firstCode: null };
    }

    const groups = new Map();
    for (const v of variants) {
        const key = v.productName ? String(v.productName) : '(Tanpa Produk)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(v);
    }

    const blocks = [];
    let firstCode = null;
    let idx = 0;
    for (const [productName, list] of groups) {
        idx += 1;
        const lines = [`📦 *#${idx} ${productName.toUpperCase()}*`];
        for (const v of list) {
            const variantName = String(v.name || '-').toUpperCase();
            const code = v.codeVariant || '-';
            const price = _priceLabel(v.price);
            if (!firstCode && code !== '-') firstCode = code;
            lines.push(`* ${variantName} │ ${price}`);
            lines.push(`    └ -Kode: \`${code}\``);
        }
        blocks.push(lines.join('\n'));
    }

    return { blocks, firstCode };
}

module.exports = {
    renderWelcomeHeader,
    renderSectionBlock,
    renderPanduanBlock,
    renderPintasanBlock,
    renderVariantCard,
    renderCompactList,
    renderSuggestionGroups
};
