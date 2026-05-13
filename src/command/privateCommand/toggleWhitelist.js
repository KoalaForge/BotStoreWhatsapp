const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const whitelistService = require('../../services/whitelistService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val === true ? 'Aktif' : 'Nonaktif';
}

/**
 * Toggle whitelist mode on/off
 * Usage: .togglewhitelist on | .togglewhitelist off
 */
const toggleWhitelist = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const settings = await settingsService.getSettings(ctx);
        const current = settings?.whitelistEnabled === true;

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Whitelist*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Cara pakai:*\n` +
                `.togglewhitelist on — Nyalakan\n` +
                `.togglewhitelist off — Matikan\n\n` +
                `*Saat dinyalakan:*\n` +
                `Setiap user yang menjalankan .start akan otomatis mengirim permintaan ke admin. User baru bisa pakai bot setelah Anda menyetujui. User lama otomatis kembali ke status menunggu dan perlu disetujui ulang.\n\n` +
                `User yang ditolak baru bisa minta lagi setelah 24 jam.\n\n` +
                `_Lihat daftar yang menunggu: .listwhitelist_`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid.*\n\nGunakan on atau off.\nContoh: .togglewhitelist on`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `Whitelist sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*. Tidak ada perubahan.`
            );
        }

        await settingsService.updateSettings(ctx, { whitelistEnabled: enabled });

        let resetCount = 0;
        if (enabled) {
            try {
                resetCount = await whitelistService.bulkResetForBot(ctx);
            } catch (resetErr) {
                console.log(
                    clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
                    clc.redBright(`bulkResetForBot failed: ${resetErr.message}`)
                );
            }
        }

        const enabledMsg =
            `*Whitelist berhasil dinyalakan.*\n\n` +
            `*${resetCount}* user lama otomatis kembali ke status menunggu dan perlu disetujui ulang.\n\n` +
            `Langkah berikutnya:\n` +
            `- Lihat daftar yang menunggu: .listwhitelist\n` +
            `- Setujui via command: .approvewhitelist <nomor>\n` +
            `- User baru yang menjalankan .start akan otomatis mengirim permintaan ke Anda.`;

        const disabledMsg =
            `*Whitelist berhasil dimatikan.*\n\n` +
            `Semua user kembali bisa pakai bot tanpa perlu disetujui. Status user yang sudah disetujui / ditolak tetap tersimpan, jadi tidak hilang kalau nanti Anda nyalakan lagi.`;

        await ctx.reply(enabled ? enabledMsg : disabledMsg);

        console.log(
            clc.green.bold('[ SUCCESS ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`whitelistEnabled set to '${enabled}' by ${ctx.from} (resetCount=${resetCount})`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleWhitelist: ${err.message}`)
        );
    }
};

module.exports = toggleWhitelist;
