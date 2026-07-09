const BaseRepository = require('./BaseRepository');
const VariantWhitelistModel = require('../database/models/variantWhitelistModels');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Variant Whitelist Repository
 * Per-(buyer, target) approval status, scoped to a variant or a product.
 * Owner-level isolation. codeVariant + productCode are case-insensitive.
 */
class VariantWhitelistRepository extends BaseRepository {
    constructor() {
        super(VariantWhitelistModel, IsolationStrategy.OwnerScoped, {
            caseInsensitiveFields: ['codeVariant', 'productCode']
        });
    }

    _scopeFilter(idWhatsapp, scope, target) {
        return scope === 'product'
            ? { idWhatsapp, scope: 'product', productCode: target }
            : { idWhatsapp, scope: 'variant', codeVariant: target };
    }

    /**
     * Fetch both the variant-scope and product-scope rows for a buyer in one query.
     * codeVariant/productCode normalized here (they sit inside $or, which
     * BaseRepository does not auto-normalize).
     */
    async findBothAccess(ctx, idWhatsapp, codeVariant, productCode) {
        const or = [];
        if (codeVariant) or.push({ scope: 'variant', codeVariant: String(codeVariant).toLowerCase() });
        if (productCode) or.push({ scope: 'product', productCode: String(productCode).toLowerCase() });
        if (!or.length) return { variantRow: null, productRow: null };

        const rows = await this.find(ctx, { idWhatsapp, $or: or });
        return {
            variantRow: rows.find(r => r.scope === 'variant') || null,
            productRow: rows.find(r => r.scope === 'product') || null
        };
    }

    /**
     * Set status, creating the row if missing (admin manual approve/reject or
     * flipping a pending request). Upsert + unique index make concurrent admin
     * actions safe: a duplicate insert is treated as "already handled".
     */
    async grantStatus(ctx, idWhatsapp, scope, target, newStatus, adminId = null) {
        const filter = this._scopeFilter(idWhatsapp, scope, target);
        try {
            const res = await this.updateOne(
                ctx,
                filter,
                {
                    $set: {
                        whitelist_status: newStatus,
                        whitelist_actioned_at: new Date(),
                        whitelist_actioned_by: adminId
                    }
                },
                { upsert: true, setDefaultsOnInsert: true }
            );
            return { changed: (res.upsertedCount > 0) || (res.modifiedCount > 0) };
        } catch (e) {
            if (e && e.code === 11000) return { changed: false };
            throw e;
        }
    }

    /**
     * Mark (buyer, target) pending and bump request count atomically.
     * ownerId + scope + target are carried onto the upserted doc via the filter.
     */
    async markPending(ctx, idWhatsapp, scope, target, name = null) {
        const now = new Date();
        const filter = this._scopeFilter(idWhatsapp, scope, target);
        return await this.findOneAndUpdate(
            ctx,
            filter,
            {
                $set: {
                    whitelist_status: 'pending',
                    whitelist_requested_at: now,
                    whitelist_actioned_at: null,
                    whitelist_actioned_by: null,
                    name
                },
                $inc: { whitelist_request_count: 1 }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    /**
     * Paginated rows for one target filtered by status.
     */
    async findByStatus(ctx, scope, target, status, { page = 1, limit = 10 } = {}) {
        const filter = scope === 'product'
            ? { scope: 'product', productCode: String(target).toLowerCase(), whitelist_status: status }
            : { scope: 'variant', codeVariant: String(target).toLowerCase(), whitelist_status: status };
        const sort = status === 'pending'
            ? { whitelist_requested_at: 1 }
            : { whitelist_actioned_at: -1 };
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
        const skip = (safePage - 1) * safeLimit;

        const [users, total] = await Promise.all([
            this.find(ctx, filter, { sort, skip, limit: safeLimit }),
            this.count(ctx, filter)
        ]);
        return { users, total, page: safePage, limit: safeLimit };
    }
}

module.exports = new VariantWhitelistRepository();
