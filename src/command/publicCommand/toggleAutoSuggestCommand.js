const clc = require('cli-color');
const moment = require('moment-timezone');
const groupSettingsService = require('../../services/groupSettingsService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val === true ? '✅ Aktif' : '❌ Nonaktif';
}

const toggleAutoSuggestCommand = async (ctx) => {
    if (!ctx.isGroup) {
        return ctx.reply('*Command ini hanya untuk group*');
    }
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const groupJid = ctx.chat;
        const current = await groupSettingsService.isAutoSuggestEnabled(ctx, groupJid);

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Auto-Suggest*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.autosuggest on — Bot proaktif kasih saran saat ada yang sebut nama produk\n` +
                `.autosuggest off — Bot diam, hanya respon command eksplisit\n\n` +
                `*Cara kerja saat aktif:*\n` +
                `Kalau anggota group ketik plain text yang mengandung nama produk/variant (mis. 'netflix'), bot otomatis kirim daftar variant + cara order.\n` +
                `Anti-spam: 1 reply per user per keyword per 5 menit.`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid!*\n\nGunakan on atau off.\nContoh: .autosuggest off`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `*Tidak ada perubahan*\n\nAuto-suggest sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*.`
            );
        }

        await groupSettingsService.setAutoSuggestEnabled(ctx, groupJid, enabled);

        await ctx.reply(
            `*Auto-suggest berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}*\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Bot akan kasih saran otomatis saat ada mention nama produk.`
                : `Bot tidak akan kasih saran otomatis di group ini. Member tetap bisa pakai command eksplisit.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`autoSuggestEnabled=${enabled} groupJid=${groupJid} by ${ctx.from}`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleAutoSuggestCommand: ${err.message}`)
        );
    }
};

module.exports = toggleAutoSuggestCommand;
