const productVariantRepository = require('../repositories/ProductVariantRepository');
const variantSearchCache = require('../state/variantSearchCache');
const { rankVariants } = require('../utils/variantSearchScorer');
const modeService = require('./modeService');

function _cacheKey(ctx) {
    if (modeService.isSingleMode()) return '__single__';
    const ownerId = ctx?.repositoryContext?.ownerId
        || ctx?.state?.ownerId
        || null;
    return ownerId ? `owner:${ownerId}` : '__default__';
}

async function findSimilar(ctx, query, limit = 5) {
    if (!query || String(query).trim().length === 0) return [];

    const key = _cacheKey(ctx);
    let variants = variantSearchCache.get(key);
    if (!variants) {
        variants = await productVariantRepository.findActiveVariants(ctx);
        variantSearchCache.set(key, variants);
    }

    return rankVariants(query, variants, limit);
}

function invalidate(ctx) {
    const key = _cacheKey(ctx);
    variantSearchCache.invalidate(key);
}

function invalidateAll() {
    variantSearchCache.invalidate(null);
}

module.exports = { findSimilar, invalidate, invalidateAll };
