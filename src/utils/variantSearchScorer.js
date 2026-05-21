const levenshtein = require('./levenshtein');

const FUZZY_MIN_QUERY_LENGTH = 4;

function scoreVariant(query, variant) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return 0;

    const code = String(variant.codeVariant || '').toLowerCase();
    const name = String(variant.name || '').toLowerCase();
    const productName = String(variant.productName || '').toLowerCase();
    let score = 0;

    if (code === q) {
        score += 1000;
    } else if (code.startsWith(q)) {
        score += 500;
    } else if (code.includes(q)) {
        score += 300;
    }

    if (productName.startsWith(q)) {
        score += 250;
    } else if (productName.includes(q)) {
        score += 200;
    }

    if (name.startsWith(q)) {
        score += 200;
    } else if (name.includes(q)) {
        score += 150;
    }

    if (score === 0 && q.length >= FUZZY_MIN_QUERY_LENGTH) {
        const threshold = Math.min(3, Math.floor(q.length / 2));
        if (threshold > 0) {
            const codePrefix = code.slice(0, q.length);
            const namePrefix = name.slice(0, q.length);
            const productPrefix = productName.slice(0, q.length);
            const dist = Math.min(
                levenshtein(q, codePrefix),
                levenshtein(q, namePrefix),
                productPrefix ? levenshtein(q, productPrefix) : Infinity
            );
            if (dist <= threshold) {
                score = Math.max(10, 100 - dist * 30);
            }
        }
    }

    return score;
}

function rankVariantsWithScore(query, variants, limit = 5) {
    if (!Array.isArray(variants) || variants.length === 0) return [];

    const scored = [];
    for (const v of variants) {
        const score = scoreVariant(query, v);
        if (score > 0) scored.push({ variant: v, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

function rankVariants(query, variants, limit = 5) {
    return rankVariantsWithScore(query, variants, limit).map(s => s.variant);
}

module.exports = { scoreVariant, rankVariants, rankVariantsWithScore };
