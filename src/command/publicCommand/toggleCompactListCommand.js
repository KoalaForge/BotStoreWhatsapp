const clc = require('cli-color');
const moment = require('moment-timezone');
const groupSettingsService = require('../../services/groupSettingsService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val === true ? '✅ Aktif' : '❌ Nonaktif';
}

const toggleCompactListCommand = async (ctx) => {
    if (!ctx.isGroup) {
        return ctx.reply('*Command ini hanya untuk group*');
    }
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const groupJid = ctx.chat;
        const current = await groupSettingsService.isCompactListEnabled(ctx, groupJid);

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Compact List Mode*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.compactlist on — Aktifkan format ringkas untuk .list\n` +
                `.compactlist off — Kembali ke format normal\n\n` +
                `*Dampak saat aktif:*\n` +
                `- Command .list di group ini menampilkan daftar ringkas (kode, nama, harga)\n` +
                `- Alias .produk / .listproduk / .listproduct tetap format lengkap\n` +
                `- Variant habis stok disembunyikan dari daftar`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid!*\n\nGunakan on atau off.\nContoh: .compactlist on`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `*Tidak ada perubahan*\n\nCompact list mode sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*.`
            );
        }

        await groupSettingsService.setCompactListEnabled(ctx, groupJid, enabled);

        await ctx.reply(
            `*Compact list mode berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}*\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Sekarang .list di group ini menampilkan format ringkas.`
                : `.list di group ini kembali ke format lengkap.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`compactListEnabled=${enabled} groupJid=${groupJid} by ${ctx.from}`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleCompactListCommand: ${err.message}`)
        );
    }
};

module.exports = toggleCompactListCommand;
