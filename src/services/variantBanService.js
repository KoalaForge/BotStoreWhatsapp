const variantBanRepository = require('../repositories/VariantBanRepository');

// Thin business layer over VariantBanRepository. A ban row existing = enforced;
// no global toggle. Keeps command/guard code decoupled from the repository.

/**
 * Returns the matching ban row (variant- or product-scoped) or null.
 */
async function isBanned(ctx, idWhatsapp, codeVariant, productCode) {
    return await variantBanRepository.isBanned(ctx, idWhatsapp, codeVariant, productCode);
}

async function banVariant(ctx, opts) {
    return await variantBanRepository.banVariant(ctx, opts);
}

async function banProduct(ctx, opts) {
    return await variantBanRepository.banProduct(ctx, opts);
}

async function findVariantBan(ctx, idWhatsapp, codeVariant) {
    return await variantBanRepository.findVariantBan(ctx, idWhatsapp, codeVariant);
}

async function findProductBan(ctx, idWhatsapp, productCode) {
    return await variantBanRepository.findProductBan(ctx, idWhatsapp, productCode);
}

async function unbanVariant(ctx, idWhatsapp, codeVariant) {
    return await variantBanRepository.unbanVariant(ctx, idWhatsapp, codeVariant);
}

async function unbanProduct(ctx, idWhatsapp, productCode) {
    return await variantBanRepository.unbanProduct(ctx, idWhatsapp, productCode);
}

async function listBans(ctx, opts) {
    return await variantBanRepository.findBans(ctx, opts);
}

module.exports = {
    isBanned,
    banVariant,
    banProduct,
    findVariantBan,
    findProductBan,
    unbanVariant,
    unbanProduct,
    listBans
};
