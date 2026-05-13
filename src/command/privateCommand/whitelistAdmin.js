const clc = require('cli-color');
const moment = require('moment-timezone');
const botUserRepository = require('../../repositories/BotUserRepository');
const whitelistService = require('../../services/whitelistService');
const waWhitelistCheck = require('../../middleware/waWhitelistCheck');
const { requireAdmin } = require('../../middleware/waAuth');
const { stripPhone, toJid } = require('../../utils/jidHelper');

const VALID_STATUS = ['pending', 'approved', 'rejected'];
const PAGE_SIZE = 10;

function _statusEmoji(status) {
    return status === 'approved' ? '[APPROVED]' : status === 'rejected' ? '[REJECTED]' : '[PENDING]';
}

function _formatTimeAgo(date) {
    if (!date) return '-';
    return moment(date).tz('Asia/Jakarta').format('DD/MM HH:mm');
}

async function _renderList(ctx, status, page) {
    const adminPhones = await whitelistService.getAdminPhones(ctx);
    // Self-heal: any admin record left in pending/rejected from prior bulk reset is flagged approved
    await botUserRepository.bulkApproveWhatsappPhones(ctx, adminPhones);

    const { users, total } = await botUserRepository.findByWhitelistStatus(ctx, status, {
        page,
        limit: PAGE_SIZE,
        excludePhones: adminPhones
    });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const header = `*Daftar Whitelist — ${_statusEmoji(status)}*\nTotal: *${total}* user — Halaman ${page}/${totalPages}\n\n`;

    let body;
    if (users.length === 0) {
        body = `_Tidak ada user dengan status ini._`;
    } else {
        body = users.map((u, i) => {
            const idx = (page - 1) * PAGE_SIZE + i + 1;
            const phone = stripPhone(u.idWhatsapp);
            const name = u.usernameTelegram || '(tanpa nama)';
            const dateField = status === 'pending' ? u.whitelist_requested_at : u.whitelist_actioned_at;
            const reqCount = u.whitelist_request_count || 0;
            const lines = [
                `*${idx}.* ${name}`,
                `   Nomor: ${phone}`,
                `   Permintaan: ${reqCount}x — ${_formatTimeAgo(dateField)}`
            ];
            if (status === 'pending') {
                lines.push(`   _Setuju:_ .approvewhitelist ${phone}`);
                lines.push(`   _Tolak:_ .rejectwhitelist ${phone}`);
            }
            return lines.join('\n');
        }).join('\n\n');
    }

    let footer = '';
    if (totalPages > 1) {
        footer += `\n\n_Halaman lain:_\n.listwhitelist ${status} <nomor halaman>\n`;
    }
    footer += `\n_Status lain:_\n.listwhitelist pending\n.listwhitelist approved\n.listwhitelist rejected`;

    return header + body + footer;
}

const listWhitelist = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const rawStatus = (args[0] || 'pending').toLowerCase();
        const status = VALID_STATUS.includes(rawStatus) ? rawStatus : 'pending';
        const page = Math.max(1, parseInt(args[1], 10) || 1);

        const text = await _renderList(ctx, status, page);
        await ctx.reply(text);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`listWhitelist: ${err.message}`)
        );
    }
};

async function _notifyUser(ctx, phone, message) {
    try {
        await ctx.sock.sendMessage(toJid(phone), { text: message });
    } catch (err) {
        console.log(
            clc.yellow('[ WHITELIST ]') + ` notify user ${phone} fail: ${err.message}`
        );
    }
}

const approveWhitelist = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const phone = stripPhone(args[0]);
        if (!phone) {
            return ctx.reply(
                '*Format salah.*\n\nPenggunaan: .approvewhitelist <nomor>\nContoh: .approvewhitelist 6281234567890'
            );
        }

        const result = await whitelistService.approve(ctx, phone, ctx.from);
        if (!result.changed) {
            return ctx.reply(`User *${phone}* sudah berstatus approved atau tidak ditemukan.`);
        }

        await ctx.reply(`*Berhasil.* User *${phone}* telah disetujui.`);
        await _notifyUser(ctx, phone, '*Akses Disetujui*\n\nPermohonan Anda telah disetujui. Ketik .start untuk memulai.');
        waWhitelistCheck.invalidateUser(ctx?.state?.botId, phone);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`approveWhitelist: ${err.message}`)
        );
    }
};

const rejectWhitelist = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const phone = stripPhone(args[0]);
        if (!phone) {
            return ctx.reply(
                '*Format salah.*\n\nPenggunaan: .rejectwhitelist <nomor>\nContoh: .rejectwhitelist 6281234567890'
            );
        }

        const result = await whitelistService.reject(ctx, phone, ctx.from);
        if (!result.changed) {
            return ctx.reply(`User *${phone}* sudah berstatus rejected atau tidak ditemukan.`);
        }

        await ctx.reply(`*Berhasil.* User *${phone}* telah ditolak.`);
        await _notifyUser(ctx, phone, '*Akses Ditolak*\n\nPermohonan Anda ditolak. Anda dapat mengajukan kembali setelah 24 jam.');
        waWhitelistCheck.invalidateUser(ctx?.state?.botId, phone);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`rejectWhitelist: ${err.message}`)
        );
    }
};

module.exports = {
    listWhitelist,
    approveWhitelist,
    rejectWhitelist
};
