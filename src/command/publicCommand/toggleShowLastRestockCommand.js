const clc = require('cli-color');
const moment = require('moment-timezone');
const groupSettingsService = require('../../services/groupSettingsService');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val === true ? '✅ Aktif' : '❌ Nonaktif';
}

/**
 * Toggle "last restock" indicator on the catalog (.list / .produk / .listproduk).
 *
 * Scope is context-aware:
 * - In a GROUP → toggle is per-group, stored in groupSettings.
 * - In a DM    → toggle is global per-bot, stored in settings (covers DM + any
 *                group that hasn't explicitly set its own per-group value).
 *
 * Default: OFF in both scopes.
 */
const toggleShowLastRestockCommand = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    const inGroup = ctx.isGroup;

    try {
        const args = ctx.commandArgs || [];
        const groupJid = ctx.chat;

        const current = inGroup
            ? await groupSettingsService.isShowLastRestockEnabled(ctx, groupJid)
            : ((await settingsService.getSettings(ctx))?.showLastRestockEnabled === true);

        const scopeLabel = inGroup ? 'grup ini' : 'DM/global (default semua DM + grup tanpa setting sendiri)';

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Info Restok* — _scope: ${scopeLabel}_\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.togglerestokinfo on — Tampilkan waktu restok terakhir di .list\n` +
                `.togglerestokinfo off — Sembunyikan info restok\n\n` +
                `*Scope:*\n` +
                `- Jalankan di *grup* → toggle hanya berlaku untuk grup itu\n` +
                `- Jalankan di *DM* → toggle berlaku global (default untuk DM + grup yg belum di-set)\n\n` +
                `*Dampak saat aktif:*\n` +
                `- Setiap variant di .list/.produk/.listproduk menampilkan baris 🔄 Restok\n` +
                `- Nilai berupa relative time (mis: 5 jam lalu, 1 hari lalu, 1 minggu lalu)\n` +
                `- Variant tanpa entry stok (HABIS & data terhapus) tidak menampilkan baris ini\n` +
                `- Variant reseller juga ikut tampil (pakai data stok platform)\n` +
                `- Mode .compactlist tidak terpengaruh — tetap format ringkas`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid!*\n\nGunakan on atau off.\nContoh: .togglerestokinfo on`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `*Tidak ada perubahan*\n\nInfo restok sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}* untuk ${scopeLabel}.`
            );
        }

        if (inGroup) {
            await groupSettingsService.setShowLastRestockEnabled(ctx, groupJid, enabled);
        } else {
            await settingsService.updateSettings(ctx, { showLastRestockEnabled: enabled });
        }

        await ctx.reply(
            `*Info restok berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}* — _scope: ${scopeLabel}_\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Sekarang .list di ${scopeLabel} menampilkan baris 🔄 Restok per variant.`
                : `Baris 🔄 Restok disembunyikan dari .list di ${scopeLabel}.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`showLastRestockEnabled=${enabled} scope=${inGroup ? 'group:' + groupJid : 'global'} by ${ctx.from}`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleShowLastRestockCommand: ${err.message}`)
        );
    }
};

module.exports = toggleShowLastRestockCommand;
