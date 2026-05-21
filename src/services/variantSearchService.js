const productVariantRepository = require('../repositories/ProductVariantRepository');
const productRepository = require('../repositories/ProductRepository');
const variantSearchCache = require('../state/variantSearchCache');
const { rankVariants, rankVariantsWithScore } = require('../utils/variantSearchScorer');
const modeService = require('./modeService');

function _cacheKey(ctx) {
    if (modeService.isSingleMode()) return '__single__';
    const ownerId = ctx?.repositoryContext?.ownerId
        || ctx?.state?.ownerId
        || null;
    return ownerId ? `owner:${ownerId}` : '__default__';
}

async function _loadCache(ctx, key) {
    const [variants, products] = await Promise.all([
        productVariantRepository.findActiveVariants(ctx),
        productRepository.findActiveProducts(ctx)
    ]);
    console.log('[ AUTOSUGGEST ] _loadCache', { key, variants: variants.length, products: products.length });
    const productMap = new Map(products.map(p => [p.code, p.name]));
    const enriched = variants.map(v => ({
        ...v,
        productName: productMap.get(v.code) || null
    }));
    if (enriched.length === 0) {
        console.log('[ AUTOSUGGEST ] _loadCache EMPTY — kemungkinan isolation filter mismatch atau DB kosong (cek mode + ownerId)');
    }
    variantSearchCache.set(key, enriched);
    return enriched;
}

async function findSimilar(ctx, query, limit = 5) {
    if (!query || String(query).trim().length === 0) return [];

    const key = _cacheKey(ctx);
    let variants = variantSearchCache.get(key);
    if (!variants) {
        variants = await _loadCache(ctx, key);
    }

    const ranked = rankVariants(query, variants, limit);
    if (ranked.length === 0) return [];

    const ownerId = ctx?.repositoryContext?.ownerId || null;
    const pricingService = ctx?.pricingService;

    return await Promise.all(ranked.map(async (v) => {
        let price = Number(v.price) || 0;
        if (pricingService) {
            try {
                price = await pricingService.calculatePriceForQty(v, ownerId, 1);
            } catch (_) {
                // fallback to raw price
            }
        }
        return {
            codeVariant: v.codeVariant,
            name: v.name,
            productName: v.productName || null,
            price
        };
    }));
}

async function findSimilarScored(ctx, query, limit = 10) {
    if (!query || String(query).trim().length === 0) return [];

    const key = _cacheKey(ctx);
    let variants = variantSearchCache.get(key);
    if (!variants) {
        variants = await _loadCache(ctx, key);
    }

    return rankVariantsWithScore(query, variants, limit);
}

async function enrichPrices(ctx, variants) {
    if (!Array.isArray(variants) || variants.length === 0) return [];
    const ownerId = ctx?.repositoryContext?.ownerId || null;
    const pricingService = ctx?.pricingService;

    return await Promise.all(variants.map(async (v) => {
        let price = Number(v.price) || 0;
        if (pricingService) {
            try {
                price = await pricingService.calculatePriceForQty(v, ownerId, 1);
            } catch (_) {
                // fallback to raw price
            }
        }
        return {
            codeVariant: v.codeVariant,
            name: v.name,
            productName: v.productName || null,
            price
        };
    }));
}

function invalidate(ctx) {
    const key = _cacheKey(ctx);
    variantSearchCache.invalidate(key);
}

function invalidateAll() {
    variantSearchCache.invalidate(null);
}

module.exports = { findSimilar, findSimilarScored, enrichPrices, invalidate, invalidateAll };
