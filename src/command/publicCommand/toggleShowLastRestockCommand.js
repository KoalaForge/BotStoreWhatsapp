const clc = require('cli-color');
const moment = require('moment-timezone');
const groupSettingsService = require('../../services/groupSettingsService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val === true ? '✅ Aktif' : '❌ Nonaktif';
}

const toggleShowLastRestockCommand = async (ctx) => {
    if (!ctx.isGroup) {
        return ctx.reply('*Command ini hanya untuk group*');
    }
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const groupJid = ctx.chat;
        const current = await groupSettingsService.isShowLastRestockEnabled(ctx, groupJid);

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Info Restok*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.togglerestokinfo on — Tampilkan waktu restok terakhir di .list\n` +
                `.togglerestokinfo off — Sembunyikan info restok\n\n` +
                `*Dampak saat aktif:*\n` +
                `- Setiap variant di .list/.produk/.listproduk menampilkan baris 🔄 Restok\n` +
                `- Nilai berupa relative time (mis: 5 jam lalu, 1 hari lalu, 1 minggu lalu)\n` +
                `- Variant tanpa entry stok (HABIS & data terhapus) tidak menampilkan baris ini\n` +
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
                `*Tidak ada perubahan*\n\nInfo restok sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*.`
            );
        }

        await groupSettingsService.setShowLastRestockEnabled(ctx, groupJid, enabled);

        await ctx.reply(
            `*Info restok berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}*\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Sekarang .list di group ini menampilkan baris 🔄 Restok per variant.`
                : `Baris 🔄 Restok disembunyikan dari .list di group ini.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`showLastRestockEnabled=${enabled} groupJid=${groupJid} by ${ctx.from}`)
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
