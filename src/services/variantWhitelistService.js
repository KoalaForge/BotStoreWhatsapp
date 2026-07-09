const moment = require('moment-timezone');
const clc = require('cli-color');
const variantWhitelistRepository = require('../repositories/VariantWhitelistRepository');
const settingsService = require('./settingsService');
const modeService = require('./modeService');
const { getNotificationIds } = require('../utils/waNotifications');
const { isAdmin } = require('../utils/checkRole');
const { stripPhone } = require('../utils/jidHelper');
const { withRetry } = require('../utils/waRetry');

// Per-(buyer, target) whitelist with admin approval. Access is granted if the
// buyer is approved at variant scope OR at product scope. The request created
// when a gated variant is tapped is product-scoped, so one approval unlocks all
// of that product's variants; admins can still approve a single variant.
// WhatsApp has no buttons — admins act by typing the printed .command lines.

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getCooldownStatus(row) {
    if (!row || row.whitelist_status !== 'rejected' || !row.whitelist_actioned_at) {
        return { active: false, remainingMs: 0 };
    }
    const elapsed = Date.now() - new Date(row.whitelist_actioned_at).getTime();
    if (elapsed >= COOLDOWN_MS) return { active: false, remainingMs: 0 };
    return { active: true, remainingMs: COOLDOWN_MS - elapsed };
}

function formatRemaining(ms) {
    const hrs = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    if (hrs > 0) return `${hrs} jam ${mins} menit`;
    return `${mins} menit`;
}

function buildAdminNotifMessage(ctx, row, info = {}) {
    const phone = stripPhone(row.idWhatsapp || ctx.from);
    const name = row?.name || ctx?.fromUser?.first_name || '(tanpa nama)';
    const requestCount = row?.whitelist_request_count || 1;
    const ts = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
    const botLabel = (modeService.isMultiMode() && ctx?.state?.botId)
        ? `\nBot: ${ctx.state.botId}` : '';
    const isProduct = row.scope === 'product';
    const target = isProduct ? row.productCode : row.codeVariant;
    const cmdWord = isProduct ? 'product' : 'variant';
    const title = isProduct ? 'Permohonan Akses Produk' : 'Permohonan Akses Variant';
    const scopeLine = isProduct
        ? `Produk: ${info?.productName || target} (${target})${info?.variantName ? `\nVariant diakses: ${info.variantName}` : ''}`
        : `Variant: ${info?.variantName || target} (${target})`;
    const footer = isProduct ? 'Menyetujui membuka semua variant produk ini.' : 'Menyetujui membuka variant ini.';

    return `*${title}*

${scopeLine}
Nomor: ${phone}
Nama: ${name}${botLabel}
Permohonan ke: ${requestCount}
Waktu: ${ts} WIB

${footer}
*Setuju:* .approve${cmdWord} ${target} ${phone}
*Tolak:* .reject${cmdWord} ${target} ${phone}`;
}

async function dispatchAdminNotification(ctx, row, info = {}) {
    const botId = ctx?.state?.botId ?? null;
    const ids = await getNotificationIds(botId);
    if (!ids || ids.length === 0) {
        console.log(clc.yellow('[ VWHITELIST ]') + ` [${moment().format('HH:mm:ss')}] No admin JIDs configured`);
        return 0;
    }
    const text = buildAdminNotifMessage(ctx, row, info);
    let sent = 0;
    for (const jid of ids) {
        try {
            await withRetry(() => ctx.sock.sendMessage(jid, { text }));
            sent++;
        } catch (err) {
            console.log(clc.red('[ VWHITELIST ]') + ` notif fail to ${jid}: ${err.message}`);
        }
    }
    return sent;
}

/**
 * Create/refresh a pending request (scope-aware: 'product' or 'variant') and
 * notify admins. Scope follows whichever level was flagged as requiring whitelist.
 */
async function requestApproval(ctx, idWhatsapp, scope, target, name = null, info = {}) {
    const updated = await variantWhitelistRepository.markPending(ctx, idWhatsapp, scope, target, name);
    const rowPayload = updated || {
        idWhatsapp,
        scope,
        productCode: scope === 'product' ? target : null,
        codeVariant: scope === 'variant' ? target : null,
        name,
        whitelist_request_count: 1
    };
    await dispatchAdminNotification(ctx, rowPayload, info);
    return updated;
}

async function approve(ctx, idWhatsapp, scope, target, adminId) {
    return await variantWhitelistRepository.grantStatus(ctx, idWhatsapp, scope, target, 'approved', adminId);
}

async function reject(ctx, idWhatsapp, scope, target, adminId) {
    return await variantWhitelistRepository.grantStatus(ctx, idWhatsapp, scope, target, 'rejected', adminId);
}

/**
 * Resolve access for a (buyer, variant). Allowed if approved at variant OR
 * product scope. When blocked, the reason comes from the GATE scope's row (the
 * level flagged as requiring whitelist). Reasons: admin | approved (allowed);
 * pending | cooldown | rejected_expired | none (blocked).
 */
async function checkVariantAccess(ctx, idWhatsapp, codeVariant, productCode, gateScope = 'product') {
    if (await isAdmin(idWhatsapp, ctx)) return { allowed: true, reason: 'admin' };

    const { variantRow, productRow } = await variantWhitelistRepository.findBothAccess(ctx, idWhatsapp, codeVariant, productCode);

    if (variantRow?.whitelist_status === 'approved' || productRow?.whitelist_status === 'approved') {
        return { allowed: true, reason: 'approved', variantRow, productRow };
    }

    const gateRow = gateScope === 'variant' ? variantRow : productRow;
    const status = gateRow?.whitelist_status || 'none';
    if (status === 'pending') return { allowed: false, reason: 'pending', gateRow };
    if (status === 'rejected') {
        const cd = getCooldownStatus(gateRow);
        if (cd.active) return { allowed: false, reason: 'cooldown', gateRow, cooldown: cd };
        return { allowed: false, reason: 'rejected_expired', gateRow };
    }
    return { allowed: false, reason: 'none', gateRow };
}

module.exports = {
    COOLDOWN_MS,
    getCooldownStatus,
    formatRemaining,
    buildAdminNotifMessage,
    dispatchAdminNotification,
    requestApproval,
    approve,
    reject,
    checkVariantAccess
};
