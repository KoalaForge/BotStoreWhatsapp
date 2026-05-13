const clc = require('cli-color');
const moment = require('moment-timezone');
const settingsService = require('../../services/settingsService');
const { requireAdmin } = require('../../middleware/waAuth');

const VALID_VALUES = ['on', 'off'];

function _statusLabel(val) {
    return val !== false ? '✅ Aktif' : '❌ Nonaktif';
}

/**
 * Toggle saldo (balance) feature on/off
 * Usage: .togglesaldo on | .togglesaldo off
 */
const toggleSaldo = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const settings = await settingsService.getSettings(ctx);
        const current = settings?.saldoEnabled !== false;

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Fitur Saldo*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.togglesaldo on — Aktifkan fitur saldo\n` +
                `.togglesaldo off — Nonaktifkan fitur saldo\n\n` +
                `*Dampak saat nonaktif:*\n` +
                `- Command .saldo tidak bisa diakses customer\n` +
                `- Opsi "Bayar dengan Saldo" disembunyikan dari menu pesanan\n` +
                `- Jika customer mencoba paksa, ditolak dengan pesan informatif`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid!*\n\nGunakan on atau off.\nContoh: .togglesaldo on`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `*Tidak ada perubahan*\n\nFitur saldo sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*.`
            );
        }

        await settingsService.updateSettings(ctx, { saldoEnabled: enabled });

        await ctx.reply(
            `*Fitur Saldo berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}*\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Customer sekarang dapat menggunakan fitur saldo dan top-up.`
                : `Customer tidak dapat mengakses fitur saldo.\nOpsi "Bayar dengan Saldo" disembunyikan dari menu pesanan.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`saldoEnabled set to '${enabled}' by user ${ctx.from}`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleFeature/toggleSaldo: ${err.message}`)
        );
    }
};

/**
 * Toggle welcome/start page feature on/off
 * Usage: .togglewelcome on | .togglewelcome off
 */
const toggleWelcome = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];
        const settings = await settingsService.getSettings(ctx);
        const current = settings?.welcomeEnabled !== false;

        if (args.length === 0) {
            return ctx.reply(
                `*Pengaturan Fitur Halaman Welcome*\n\n` +
                `*Status saat ini:* ${_statusLabel(current)}\n\n` +
                `*Penggunaan:*\n` +
                `.togglewelcome on — Aktifkan halaman welcome\n` +
                `.togglewelcome off — Nonaktifkan halaman welcome\n\n` +
                `*Dampak saat nonaktif:*\n` +
                `- Command .start langsung menampilkan daftar produk\n` +
                `- Statistik bot (total user, terjual, saldo) tidak ditampilkan\n` +
                `- Foto/banner intro tidak dikirim`
            );
        }

        const value = args[0].toLowerCase().trim();
        if (!VALID_VALUES.includes(value)) {
            return ctx.reply(
                `*Nilai tidak valid!*\n\nGunakan on atau off.\nContoh: .togglewelcome on`
            );
        }

        const enabled = value === 'on';

        if (enabled === current) {
            return ctx.reply(
                `*Tidak ada perubahan*\n\nFitur halaman welcome sudah dalam status *${enabled ? 'Aktif' : 'Nonaktif'}*.`
            );
        }

        await settingsService.updateSettings(ctx, { welcomeEnabled: enabled });

        await ctx.reply(
            `*Fitur Halaman Welcome berhasil ${enabled ? 'diaktifkan' : 'dinonaktifkan'}*\n\n` +
            `*Status baru:* ${_statusLabel(enabled)}\n\n` +
            (enabled
                ? `Command .start kembali menampilkan halaman welcome dengan statistik bot.`
                : `Command .start sekarang langsung menampilkan daftar produk.\nHalaman statistik & banner intro dilewati.`)
        );

        console.log(
            clc.green.bold('[ SUCCESS ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`welcomeEnabled set to '${enabled}' by user ${ctx.from}`)
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in toggleFeature/toggleWelcome: ${err.message}`)
        );
    }
};

module.exports = { toggleSaldo, toggleWelcome };
