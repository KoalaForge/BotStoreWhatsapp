const { isAdmin } = require('../utils/checkRole');
const variantBanService = require('./variantBanService');
const variantWhitelistService = require('./variantWhitelistService');

// Shared orchestrator for the two per-variant access features. Used at the
// variant-detail entry and at both payment methods. Returns { allowed, message }
// where message is a ready-to-send WhatsApp text for ctx.reply.
//
// Admins bypass both features. Whitelist gating is opt-in PER TARGET: a variant
// is gated only when the variant itself OR its product is flagged
// `requiresWhitelist`. The request/approval scope follows the flagged level.

async function _checkBan(ctx, idWhatsapp, codeVariant, productCode) {
    // A ban row existing = enforced (no global toggle; admin created it explicitly).
    const ban = await variantBanService.isBanned(ctx, idWhatsapp, codeVariant, productCode);
    if (!ban) return null;
    return `Anda diblokir dari membeli item ini.\nAlasan: ${ban.ban_reason || '-'}`;
}

/**
 * Which whitelist scope gates this variant, or null if not gated.
 * Product flag wins over variant flag (broader).
 */
function _gateScope(info) {
    if (info.productRequiresWhitelist) return 'product';
    if (info.variantRequiresWhitelist) return 'variant';
    return null;
}

/**
 * Guard for entering a variant's detail view. On a first/expired whitelist
 * request, this creates the pending request (at the gate scope) and notifies admins.
 */
async function checkEntry(ctx, idWhatsapp, codeVariant, productCode, info = {}) {
    if (await isAdmin(idWhatsapp, ctx)) return { allowed: true };

    const banMessage = await _checkBan(ctx, idWhatsapp, codeVariant, productCode);
    if (banMessage) return { allowed: false, message: banMessage };

    const gateScope = _gateScope(info);
    if (gateScope) {
        const access = await variantWhitelistService.checkVariantAccess(ctx, idWhatsapp, codeVariant, productCode, gateScope);
        if (!access.allowed) {
            switch (access.reason) {
                case 'pending':
                    return { allowed: false, message: 'Permohonan akses Anda sedang menunggu persetujuan admin.' };
                case 'cooldown':
                    return {
                        allowed: false,
                        message: `Permohonan Anda ditolak. Silakan coba lagi dalam ${variantWhitelistService.formatRemaining(access.cooldown.remainingMs)}.`
                    };
                default: {
                    const target = gateScope === 'product' ? productCode : codeVariant;
                    await variantWhitelistService.requestApproval(
                        ctx, idWhatsapp, gateScope, target, ctx?.fromUser?.first_name || null,
                        { productName: info.productName, variantName: info.variantName }
                    );
                    return { allowed: false, message: 'Permohonan akses terkirim ke admin. Anda akan diberi tahu setelah disetujui.' };
                }
            }
        }
    }

    return { allowed: true };
}

/**
 * Guard at payment (QRIS + balance). Defense-in-depth; never creates a new
 * whitelist request — the entry guard owns that.
 */
async function checkPayment(ctx, idWhatsapp, codeVariant, productCode, info = {}) {
    if (await isAdmin(idWhatsapp, ctx)) return { allowed: true };

    const banMessage = await _checkBan(ctx, idWhatsapp, codeVariant, productCode);
    if (banMessage) return { allowed: false, message: banMessage };

    const gateScope = _gateScope(info);
    if (gateScope) {
        const access = await variantWhitelistService.checkVariantAccess(ctx, idWhatsapp, codeVariant, productCode, gateScope);
        if (!access.allowed) {
            return { allowed: false, message: 'Anda belum disetujui untuk membeli item ini.' };
        }
    }

    return { allowed: true };
}

module.exports = { checkEntry, checkPayment };
