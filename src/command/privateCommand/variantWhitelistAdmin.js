const clc = require('cli-color');
const moment = require('moment-timezone');
const variantWhitelistRepository = require('../../repositories/VariantWhitelistRepository');
const variantWhitelistService = require('../../services/variantWhitelistService');
const settingsService = require('../../services/settingsService');
const productRepository = require('../../repositories/ProductRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { stripPhone, toJid } = require('../../utils/jidHelper');

const VALID_STATUS = ['pending', 'approved', 'rejected'];
const VALID_VALUES = ['on', 'off'];
const PAGE_SIZE = 10;

function _statusTag(status) {
    return status === 'approved' ? '[APPROVED]' : status === 'rejected' ? '[REJECTED]' : '[PENDING]';
}

function _scopeLabel(scope) {
    return scope === 'product' ? 'produk' : 'variant';
}

function _cmdWord(scope) {
    return scope === 'product' ? 'product' : 'variant';
}

function _formatTimeAgo(date) {
    if (!date) return '-';
    return moment(date).tz('Asia/Jakarta').format('DD/MM HH:mm');
}

function _logErr(where, err) {
    console.log(
        clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
        clc.redBright(`${where}: ${err.message}`)
    );
}

async function _notifyUser(ctx, phone, message) {
    try {
        await ctx.sock.sendMessage(toJid(phone), { text: message });
    } catch (err) {
        console.log(clc.yellow('[ VWHITELIST ]') + ` notify user ${phone} fail: ${err.message}`);
    }
}

async function _renderList(ctx, scope, target, status, page) {
    const { users, total } = await variantWhitelistRepository.findByStatus(ctx, scope, target, status, {
        page,
        limit: PAGE_SIZE
    });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const cmdWord = _cmdWord(scope);
    const listCmd = scope === 'product' ? 'listproductwl' : 'listvariantwl';

    const header = `*Whitelist ${_scopeLabel(scope)} ${target} — ${_statusTag(status)}*\nTotal: *${total}* — Halaman ${page}/${totalPages}\n\n`;

    let body;
    if (users.length === 0) {
        body = `_Tidak ada user dengan status ini untuk ${_scopeLabel(scope)} ini._`;
    } else {
        body = users.map((u, i) => {
            const idx = (page - 1) * PAGE_SIZE + i + 1;
            const phone = u.idWhatsapp;
            const name = u.name || '(tanpa nama)';
            const dateField = status === 'pending' ? u.whitelist_requested_at : u.whitelist_actioned_at;
            const reqCount = u.whitelist_request_count || 0;
            const lines = [
                `*${idx}.* ${name}`,
                `   Nomor: ${phone}`,
                `   Permintaan: ${reqCount}x — ${_formatTimeAgo(dateField)}`
            ];
            if (status === 'pending') {
                lines.push(`   _Setuju:_ .approve${cmdWord} ${target} ${phone}`);
                lines.push(`   _Tolak:_ .reject${cmdWord} ${target} ${phone}`);
            }
            return lines.join('\n');
        }).join('\n\n');
    }

    let footer = '';
    if (totalPages > 1) footer += `\n\n_Halaman lain:_ .${listCmd} ${target} ${status} <nomor halaman>`;
    footer += `\n\n_Status lain:_ .${listCmd} ${target} pending | approved | rejected`;
    return header + body + footer;
}

// Flag a whole product as requiring whitelist approval (gates all its variants).
const setProductWl = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        const raw = args[0];
        const value = (args[1] || '').toLowerCase().trim();
        if (!raw || !VALID_VALUES.includes(value)) {
            return ctx.reply('*Aktifkan/nonaktifkan whitelist pada satu produk*\n\nFormat: .setproductwl <productCode> on|off\nContoh: .setproductwl NETFLIX on\n\nSaat on: semua variant produk ini wajib approval sebelum bisa dibeli.');
        }
        const product = await productRepository.findByCode(ctx, raw);
        if (!product) return ctx.reply(`*Produk tidak ditemukan:* ${raw}`);
        const enabled = value === 'on';
        await productRepository.updateOne(ctx, { code: product.code }, { $set: { requiresWhitelist: enabled } });
        return ctx.reply(`*Berhasil.* Whitelist produk *${product.code}* di-set *${enabled ? 'ON' : 'OFF'}*.` + (enabled ? '\n\nSemua variant produk ini kini wajib approval.' : ''));
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('setProductWl', err);
    }
};

// Flag a single variant as requiring whitelist approval.
const setVariantWl = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        const raw = args[0];
        const value = (args[1] || '').toLowerCase().trim();
        if (!raw || !VALID_VALUES.includes(value)) {
            return ctx.reply('*Aktifkan/nonaktifkan whitelist pada satu variant*\n\nFormat: .setvariantwl <codeVariant> on|off\nContoh: .setvariantwl NETFLIX-1BLN on\n\nSaat on: variant ini wajib approval sebelum bisa dibeli.');
        }
        const variant = await productVariantRepository.findByCodeVariant(ctx, raw);
        if (!variant) return ctx.reply(`*Variant tidak ditemukan:* ${raw}`);
        const enabled = value === 'on';
        await productVariantRepository.updateOne(ctx, { codeVariant: variant.codeVariant }, { $set: { requiresWhitelist: enabled } });
        return ctx.reply(`*Berhasil.* Whitelist variant *${variant.codeVariant}* di-set *${enabled ? 'ON' : 'OFF'}*.`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('setVariantWl', err);
    }
};

const listVariantWl = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (!args[0]) {
            return ctx.reply(`*Format:* .listvariantwl <codeVariant> [pending|approved|rejected] [halaman]\nContoh: .listvariantwl netflix-1bln pending`);
        }
        const codeVariant = args[0].toLowerCase();
        const rawStatus = (args[1] || 'pending').toLowerCase();
        const status = VALID_STATUS.includes(rawStatus) ? rawStatus : 'pending';
        const page = Math.max(1, parseInt(args[2], 10) || 1);
        await ctx.reply(await _renderList(ctx, 'variant', codeVariant, status, page));
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('listVariantWl', err);
    }
};

const listProductWl = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (!args[0]) {
            return ctx.reply(`*Format:* .listproductwl <productCode> [pending|approved|rejected] [halaman]\nContoh: .listproductwl netflix pending`);
        }
        const product = await productRepository.findByCode(ctx, args[0]);
        if (!product) return ctx.reply(`*Produk tidak ditemukan:* ${args[0]}`);
        const rawStatus = (args[1] || 'pending').toLowerCase();
        const status = VALID_STATUS.includes(rawStatus) ? rawStatus : 'pending';
        const page = Math.max(1, parseInt(args[2], 10) || 1);
        await ctx.reply(await _renderList(ctx, 'product', product.code, status, page));
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('listProductWl', err);
    }
};

/** Shared approve/reject-by-command implementation. */
async function _actionCommand(ctx, { action, scope }) {
    const args = ctx.commandArgs || [];
    const rawTarget = args[0];
    const phone = stripPhone(args[1]);
    const cmd = `${action}${_cmdWord(scope)}`;
    if (!rawTarget || !phone) {
        const argName = scope === 'product' ? '<productCode>' : '<codeVariant>';
        return ctx.reply(`*Format salah.*\n\nPenggunaan: .${cmd} ${argName} <nomor>`);
    }

    let target;
    if (scope === 'product') {
        const product = await productRepository.findByCode(ctx, rawTarget);
        if (!product) return ctx.reply(`*Produk tidak ditemukan:* ${rawTarget}`);
        target = product.code;
    } else {
        const variant = await productVariantRepository.findByCodeVariant(ctx, rawTarget);
        if (!variant) return ctx.reply(`*Variant tidak ditemukan:* ${rawTarget}`);
        target = variant.codeVariant;
    }

    const result = action === 'approve'
        ? await variantWhitelistService.approve(ctx, phone, scope, target, ctx.from)
        : await variantWhitelistService.reject(ctx, phone, scope, target, ctx.from);

    const scopeLabel = _scopeLabel(scope);
    if (!result.changed) {
        const st = action === 'approve' ? 'approved' : 'rejected';
        return ctx.reply(`User *${phone}* sudah ${st} untuk ${scopeLabel} *${target}* atau tidak ada perubahan.`);
    }

    if (action === 'approve') {
        await ctx.reply(`*Berhasil.* User *${phone}* di-approve untuk ${scopeLabel} *${target}*.`);
        await _notifyUser(ctx, phone, `*Akses Disetujui*\n\nPermohonan Anda untuk ${scopeLabel} ${target} telah disetujui. Silakan buka kembali produk/variant tersebut.`);
    } else {
        await ctx.reply(`*Berhasil.* User *${phone}* di-reject untuk ${scopeLabel} *${target}*.`);
        await _notifyUser(ctx, phone, `*Akses Ditolak*\n\nPermohonan Anda untuk ${scopeLabel} ${target} ditolak. Anda dapat mengajukan kembali setelah 24 jam.`);
    }
}

const approveVariant = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try { await _actionCommand(ctx, { action: 'approve', scope: 'variant' }); }
    catch (err) { await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*'); _logErr('approveVariant', err); }
};

const rejectVariant = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try { await _actionCommand(ctx, { action: 'reject', scope: 'variant' }); }
    catch (err) { await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*'); _logErr('rejectVariant', err); }
};

const approveProduct = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try { await _actionCommand(ctx, { action: 'approve', scope: 'product' }); }
    catch (err) { await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*'); _logErr('approveProduct', err); }
};

const rejectProduct = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try { await _actionCommand(ctx, { action: 'reject', scope: 'product' }); }
    catch (err) { await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*'); _logErr('rejectProduct', err); }
};

module.exports = {
    setProductWl,
    setVariantWl,
    listVariantWl,
    listProductWl,
    approveVariant,
    rejectVariant,
    approveProduct,
    rejectProduct
};
