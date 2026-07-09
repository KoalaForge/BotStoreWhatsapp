const BaseRepository = require('./BaseRepository');
const VariantBanModel = require('../database/models/variantBanModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Variant Ban Repository
 * Per-buyer purchase bans, scoped to a variant or a whole product.
 * Owner-level isolation (same scope as products/variants/stock).
 * Presence of a row = banned; unban deletes the row.
 */
class VariantBanRepository extends BaseRepository {
    constructor() {
        super(VariantBanModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['codeVariant']
        });
    }

    /**
     * Return the matching ban row (variant- or product-scoped) or null.
     * codeVariant is normalized here because it sits inside $or (BaseRepository
     * only normalizes top-level filter keys).
     */
    async isBanned(ctx, idWhatsapp, codeVariant, productCode) {
        const or = [];
        if (codeVariant) {
            or.push({ scope: 'variant', codeVariant: String(codeVariant).toLowerCase() });
        }
        if (productCode) {
            or.push({ scope: 'product', productCode });
        }
        if (or.length === 0) return null;
        return await this.findOne(ctx, { idWhatsapp, $or: or });
    }

    async findVariantBan(ctx, idWhatsapp, codeVariant) {
        return await this.findOne(ctx, { scope: 'variant', idWhatsapp, codeVariant });
    }

    async findProductBan(ctx, idWhatsapp, productCode) {
        return await this.findOne(ctx, { scope: 'product', idWhatsapp, productCode });
    }

    async banVariant(ctx, { idWhatsapp, codeVariant, name = null, reason = null, adminId = null }) {
        return await this.create(ctx, {
            scope: 'variant',
            idWhatsapp,
            codeVariant,
            name,
            ban_reason: reason,
            banned_at: new Date(),
            banned_by: adminId
        });
    }

    async banProduct(ctx, { idWhatsapp, productCode, name = null, reason = null, adminId = null }) {
        return await this.create(ctx, {
            scope: 'product',
            idWhatsapp,
            productCode,
            name,
            ban_reason: reason,
            banned_at: new Date(),
            banned_by: adminId
        });
    }

    async unbanVariant(ctx, idWhatsapp, codeVariant) {
        return await this.deleteOne(ctx, { scope: 'variant', idWhatsapp, codeVariant });
    }

    async unbanProduct(ctx, idWhatsapp, productCode) {
        return await this.deleteOne(ctx, { scope: 'product', idWhatsapp, productCode });
    }

    /**
     * Paginated list of all bans in the current owner scope (newest first).
     */
    async findBans(ctx, { page = 1, limit = 10 } = {}) {
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
        const skip = (safePage - 1) * safeLimit;

        const [bans, total] = await Promise.all([
            this.find(ctx, {}, { sort: { banned_at: -1 }, skip, limit: safeLimit }),
            this.count(ctx, {})
        ]);
        return { bans, total, page: safePage, limit: safeLimit };
    }
}

module.exports = new VariantBanRepository();
