'use strict';

const clc = require('cli-color');
const moment = require('moment-timezone');
const { requireAdmin } = require('../../middleware/waAuth');
const cycleService = require('../../services/cycleService');
const productVariantRepository = require('../../repositories/ProductVariantRepository');

// ============================================
// .rekapcycle [codeVariant]
// ============================================
const rekapCycle = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        const codeVariantArg = args.length >= 1 ? args[0].trim().toLowerCase() : null;
        const filter = codeVariantArg ? { codeVariant: new RegExp(`^${codeVariantArg}$`, 'i') } : {};

        const [summary, pendingItems, incomingItems, cycledItems] = await Promise.all([
            cycleService.getCycleSummary(ctx, filter),
            cycleService.getEligibleWithTransactionInfo(ctx, 5, filter),
            cycleService.getIncomingWithTransactionInfo(ctx, 5, filter),
            cycleService.getRecentlyCycledWithTransactionInfo(ctx, 5, filter)
        ]);

        // Message 1: Summary + Pending
        let text = `*Ringkasan Stock Cycle*\n`;
        if (codeVariantArg) {
            text += `Filter: ${codeVariantArg}\n`;
        }
        text += `\n`;
        text += `*Status*\n`;
        text += `Sudah disiklus hari ini: ${summary.completedToday} item\n`;
        text += `Terjadwal (belum jatuh tempo): ${summary.scheduled} item\n`;
        text += `Segera (6 jam ke depan): ${summary.upcoming} item\n`;
        text += `Menunggu backend: ${summary.overdue} item\n`;
        text += `Gagal (akan diretry): ${summary.failed} item\n`;
        text += `Perlu intervensi manual: ${summary.stuck} item\n`;

        if (pendingItems.length > 0) {
            text += `\n*Pending Cycle (Terlambat)*\n\n`;
            for (const item of pendingItems) {
                const eligibleStr = moment(item.cycle_eligible_at).tz('Asia/Jakarta').format('DD MMM HH:mm');
                const txLabel = item.transactionId || '(unknown)';
                const buyerLabel = item.user_id ? `User ${item.user_id}` : '(unknown)';
                const statusIcon = (item.cycle_failed && item.cycle_retry_count >= 3) ? '🔴' :
                    item.cycle_failed ? '⚠️' : '🔄';
                text += `${statusIcon} ${txLabel}\n`;
                text += `   ${buyerLabel} | ${item.codeVariant} x${item.quantity}\n`;
                text += `   Eligible: ${eligibleStr} WIB\n`;
                if (Array.isArray(item.data) && item.data.length > 0) {
                    const showCount = Math.min(item.data.length, 3);
                    for (let i = 0; i < showCount; i++) {
                        text += `   ${item.data[i].dataStock}\n`;
                    }
                    if (item.data.length > 3) {
                        text += `   _...+${item.data.length - 3} lagi_\n`;
                    }
                }
                text += '\n';
            }
            const totalPending = summary.overdue + summary.failed + summary.stuck;
            if (totalPending > pendingItems.length) {
                text += `_...dan ${totalPending - pendingItems.length} item lainnya_\n\n`;
            }
            text += `Cycle semua: .cyclebulk\n`;
            text += `Cycle per order: .cycle <transactionId>`;
        } else if (summary.stuck > 0) {
            text += `\n*Item yang Perlu Perhatian*\n`;
            text += `Gunakan .ceksiklus <transactionId> untuk detail.\n`;
        }

        text += `\n\n_Tutorial: .caracycle_`;

        await ctx.reply(text);

        // Message 2: Incoming
        if (incomingItems.length > 0) {
            let incomingText = `*Incoming Cycle*\n`;
            incomingText += `_Item yang akan masuk kembali ke stok_\n\n`;
            for (const item of incomingItems) {
                const eligibleStr = moment(item.cycle_eligible_at).tz('Asia/Jakarta').format('DD MMM HH:mm');
                const txLabel = item.transactionId || '(unknown)';
                const buyerLabel = item.user_id ? `User ${item.user_id}` : '(unknown)';
                incomingText += `⏳ ${txLabel}\n`;
                incomingText += `   ${buyerLabel} | ${item.codeVariant} x${item.quantity}\n`;
                incomingText += `   Masuk: ${eligibleStr} WIB\n`;
                if (Array.isArray(item.data) && item.data.length > 0) {
                    const showCount = Math.min(item.data.length, 3);
                    for (let i = 0; i < showCount; i++) {
                        incomingText += `   ${item.data[i].dataStock}\n`;
                    }
                    if (item.data.length > 3) {
                        incomingText += `   _...+${item.data.length - 3} lagi_\n`;
                    }
                }
                incomingText += '\n';
            }
            if (summary.scheduled > incomingItems.length) {
                incomingText += `_...dan ${summary.scheduled - incomingItems.length} item lainnya_\n`;
            }
            await ctx.reply(incomingText);
        }

        // Message 3: Recently cycled
        if (cycledItems.length > 0) {
            let cycledText = `*Riwayat Cycle Terbaru*\n`;
            cycledText += `_Data yang sudah kembali ke pool stok_\n\n`;
            for (const item of cycledItems) {
                const cycledStr = moment(item.cycled_at).tz('Asia/Jakarta').format('DD MMM HH:mm');
                const txLabel = item.transactionId || '(unknown)';
                const buyerLabel = item.user_id ? `User ${item.user_id}` : '(unknown)';
                cycledText += `✅ ${txLabel}\n`;
                cycledText += `   ${buyerLabel} | ${item.codeVariant} x${item.quantity}\n`;
                cycledText += `   Disiklus: ${cycledStr} WIB\n`;
                if (Array.isArray(item.data) && item.data.length > 0) {
                    for (const record of item.data) {
                        cycledText += `   ${record.dataStock}\n`;
                    }
                }
                cycledText += '\n';
            }
            await ctx.reply(cycledText);
        }

        console.log(clc.green.bold('[ CYCLE ]') + ` [${moment().format('HH:mm:ss')}]: Recap cycle diakses oleh ${ctx.from}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in rekapCycle: ${err.message}`);
    }
};

// ============================================
// .ceksiklus <transactionId>
// ============================================
const cekSiklus = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 1) {
            return ctx.reply(
                `*Cara pakai:*\n.ceksiklus <transactionId>\n\nContoh: .ceksiklus INV-260228001`
            );
        }

        const transactionId = args[0].trim();
        const result = await cycleService.getOrderCycleStatus(ctx, transactionId);

        if (result.error === 'transaction_not_found') {
            return ctx.reply(`*Transaksi tidak ditemukan:* ${transactionId}\n\nPastikan ID transaksi sudah benar.`);
        }

        const { items } = result;

        if (items.length === 0) {
            return ctx.reply(
                `*Transaksi ${transactionId}*\n\nTidak ada item dengan fitur cycle dalam transaksi ini.\n\nKemungkinan:\n- Produk tidak mengaktifkan cycle\n- Semua item sudah di-cycle`
            );
        }

        let text = `*Status Cycle — ${transactionId}*\n\n`;

        for (const item of items) {
            const variantLabel = `${item.codeVariant} x ${item.quantity}`;

            let statusIcon, statusText;
            if (item.cycled_at) {
                statusIcon = '✅';
                statusText = `Selesai ${moment(item.cycled_at).tz('Asia/Jakarta').format('DD MMM HH:mm')} WIB`;
            } else if (item.cycle_failed && item.cycle_retry_count >= 3) {
                statusIcon = '🔴';
                statusText = `PERLU INTERVENSI (gagal ${item.cycle_retry_count}x retry)`;
            } else if (item.cycle_failed) {
                statusIcon = '⚠️';
                statusText = `Gagal, menunggu retry backend (${item.cycle_retry_count}x)`;
            } else if (item.cycle_eligible_at <= new Date()) {
                statusIcon = '🔄';
                statusText = `Menunggu backend (eligible ${moment(item.cycle_eligible_at).tz('Asia/Jakarta').format('DD MMM HH:mm')} WIB)`;
            } else {
                statusIcon = '⏳';
                statusText = `Akan disiklus ${moment(item.cycle_eligible_at).tz('Asia/Jakarta').format('DD MMM HH:mm')} WIB`;
            }

            text += `${statusIcon} *${variantLabel}*\n`;
            text += `   ${statusText}\n`;
            if (Array.isArray(item.data) && item.data.length > 0) {
                const showCount = Math.min(item.data.length, 5);
                for (let i = 0; i < showCount; i++) {
                    text += `   ${item.data[i].dataStock}\n`;
                }
                if (item.data.length > 5) {
                    text += `   _...+${item.data.length - 5} lagi_\n`;
                }
            }
            text += '\n';
        }

        const hasEligible = items.some(i => !i.cycled_at && i.cycle_eligible_at);
        if (hasEligible) {
            text += `\nCycle manual: .cycle ${transactionId}`;
        }

        await ctx.reply(text);

        console.log(clc.green.bold('[ CYCLE ]') + ` [${moment().format('HH:mm:ss')}]: Cek siklus ${transactionId} oleh ${ctx.from}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in cekSiklus: ${err.message}`);
    }
};

// ============================================
// .cycle <transactionId>
// ============================================
const cycleOrder = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 1) {
            return ctx.reply(
                `*Cara pakai:*\n.cycle <transactionId>\n\nContoh: .cycle INV-260228001\n\n_Gunakan .ceksiklus terlebih dahulu untuk melihat status._`
            );
        }

        const transactionId = args[0].trim();

        // Check for confirm flag (2-step: preview then confirm)
        const confirmFlag = args[1]?.toLowerCase() === 'confirm';

        const statusResult = await cycleService.getOrderCycleStatus(ctx, transactionId);

        if (statusResult.error === 'transaction_not_found') {
            return ctx.reply(`*Transaksi tidak ditemukan:* ${transactionId}`);
        }

        const { items } = statusResult;
        const eligibleItems = items.filter(i => !i.cycled_at && i.cycle_eligible_at && Array.isArray(i.data) && i.data.length > 0);

        if (eligibleItems.length === 0) {
            if (items.length === 0) {
                return ctx.reply('*Tidak ada item cycle dalam transaksi ini.*');
            }
            const alreadyDone = items.filter(i => i.cycled_at).length;
            return ctx.reply(
                `*Tidak ada item yang perlu di-cycle.*\n\n` +
                `✅ Sudah selesai: *${alreadyDone}* item\n` +
                `Semua item dalam transaksi ini sudah di-cycle.`
            );
        }

        if (!confirmFlag) {
            // Preview
            let previewText = `*Konfirmasi Cycle Manual*\n\n`;
            previewText += `Transaksi: ${transactionId}\n\n`;
            previewText += `Item yang akan dikembalikan ke pool stok:\n`;
            for (const item of eligibleItems) {
                previewText += `- *${item.codeVariant} x ${item.quantity}*\n`;
                const showCount = Math.min(item.data.length, 5);
                for (let i = 0; i < showCount; i++) {
                    previewText += `  ${item.data[i].dataStock}\n`;
                }
                if (item.data.length > 5) {
                    previewText += `  _...+${item.data.length - 5} lagi_\n`;
                }
            }
            previewText += `\n⚠️ *Pastikan masa berlaku item sudah habis sebelum cycle!*\n\n`;
            previewText += `Ketik .cycle ${transactionId} confirm untuk melanjutkan.`;

            await ctx.reply(previewText);
            return;
        }

        // Execute cycle
        const result = await cycleService.manualCycleTransaction(ctx, transactionId);

        if (result.error === 'transaction_not_found') {
            return ctx.reply(`*Transaksi tidak ditemukan:* ${transactionId}`);
        }

        if (result.error === 'no_eligible_items') {
            return ctx.reply(
                `*Tidak ada item yang bisa di-cycle*\n\nSemua item sudah di-cycle atau tidak ada item cycle dalam transaksi ini.`
            );
        }

        let responseText = `*Cycle Selesai — ${transactionId}*\n\n`;
        if (result.success > 0) responseText += `✅ Berhasil dikembalikan ke stok: *${result.success}* item\n`;
        if (result.alreadyCycled > 0) responseText += `ℹ️ Sudah di-cycle sebelumnya: *${result.alreadyCycled}* item\n`;
        if (result.failed > 0) responseText += `⚠️ Gagal: *${result.failed}* item (akan diretry backend)\n`;

        await ctx.reply(responseText);

        console.log(clc.green.bold('[ CYCLE SUCCESS ]') + ` [${moment().format('HH:mm:ss')}]: Manual cycle ${transactionId} oleh ${ctx.from} — success: ${result.success}, failed: ${result.failed}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in cycleOrder: ${err.message}`);
    }
};

// ============================================
// .cyclebulk [confirm]
// ============================================
const cyclebulkCommand = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        const confirmFlag = args[0]?.toLowerCase() === 'confirm';

        const pendingItems = await cycleService.getEligibleWithTransactionInfo(ctx, 20);

        if (pendingItems.length === 0) {
            return ctx.reply(
                `*Tidak ada item yang perlu di-cycle saat ini.*\n\nSemua item sudah di-cycle atau belum ada yang jatuh tempo.`
            );
        }

        if (!confirmFlag) {
            // Preview
            const byTx = new Map();
            for (const item of pendingItems) {
                const key = item.transactionId || '(unknown)';
                if (!byTx.has(key)) {
                    byTx.set(key, { user_id: item.user_id, items: [] });
                }
                byTx.get(key).items.push(item);
            }

            let previewText = `*Cycle Bulk — Konfirmasi*\n\n`;
            previewText += `Total item yang akan di-cycle: *${pendingItems.length}*\n\n`;
            previewText += `*Preview Order (maks. 20):*\n`;

            for (const [txId, data] of byTx.entries()) {
                const buyerLabel = data.user_id ? `User ${data.user_id}` : '';
                previewText += `- ${txId}${buyerLabel ? ` | ${buyerLabel}` : ''}\n`;
                for (const item of data.items) {
                    previewText += `  *${item.codeVariant}x${item.quantity}*\n`;
                    if (Array.isArray(item.data) && item.data.length > 0) {
                        const showCount = Math.min(item.data.length, 3);
                        for (let i = 0; i < showCount; i++) {
                            previewText += `  ${item.data[i].dataStock}\n`;
                        }
                        if (item.data.length > 3) {
                            previewText += `  _...+${item.data.length - 3} lagi_\n`;
                        }
                    }
                }
            }

            previewText += `\n⚠️ *Pastikan semua masa berlaku item sudah habis!*\n`;
            previewText += `Proses ini tidak bisa dibatalkan setelah dikonfirmasi.\n\n`;
            previewText += `Ketik .cyclebulk confirm untuk melanjutkan.`;

            await ctx.reply(previewText);

            console.log(clc.green.bold('[ CYCLE ]') + ` [${moment().format('HH:mm:ss')}]: Bulk cycle preview oleh ${ctx.from} — ${pendingItems.length} items`);
            return;
        }

        // Execute bulk cycle
        await ctx.reply('_Memproses bulk cycle..._');

        const result = await cycleService.bulkCycleEligible(ctx);

        if (result.total === 0) {
            return ctx.reply('*Tidak ada item yang perlu di-cycle saat ini.*');
        }

        let responseText = `*Bulk Cycle Selesai*\n\n`;
        responseText += `Total diproses: *${result.total}* item\n\n`;
        if (result.success > 0) responseText += `✅ Berhasil ke stok: *${result.success}* item\n`;
        if (result.alreadyCycled > 0) responseText += `ℹ️ Sudah di-cycle sebelumnya: *${result.alreadyCycled}* item\n`;
        if (result.failed > 0) responseText += `⚠️ Gagal: *${result.failed}* item (akan diretry backend)\n`;

        await ctx.reply(responseText);

        console.log(clc.green.bold('[ CYCLE SUCCESS ]') + ` [${moment().format('HH:mm:ss')}]: Bulk cycle oleh ${ctx.from} — total: ${result.total}, success: ${result.success}, failed: ${result.failed}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in cyclebulkCommand: ${err.message}`);
    }
};

// ============================================
// .setcyclable <codeVariant> on|off
// ============================================
const setCyclable = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(
                `*Cara pakai:*\n.setcyclable <codeVariant> on|off\n\nContoh:\n- .setcyclable netflix1h on — aktifkan cycle\n- .setcyclable netflix1h off — nonaktifkan cycle`
            );
        }

        const codeVariant = args[0].trim().toLowerCase();
        const value = args[1].trim().toLowerCase();

        if (!['on', 'off'].includes(value)) {
            return ctx.reply('*Nilai harus on atau off*');
        }

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply(`*Variant tidak ditemukan:* ${codeVariant}\n\nPastikan kode variant sudah benar.`);
        }

        const isCyclable = value === 'on';
        await productVariantRepository.setCyclable(ctx, codeVariant, isCyclable);

        const statusText = isCyclable ? '✅ *Aktif*' : '❌ *Nonaktif*';
        let responseText = `*Cycle diupdate: ${codeVariant}*\n\n`;
        responseText += `Status: ${statusText}\n`;

        if (isCyclable && !variant.duration_days) {
            responseText += `\n⚠️ *Perhatian:* Durasi cycle belum diset!\n`;
            responseText += `Gunakan: .setcycleduration ${codeVariant} <hari>`;
        } else if (isCyclable) {
            responseText += `Durasi: *${variant.duration_days} hari*`;
        }

        await ctx.reply(responseText);

        console.log(clc.green.bold('[ CYCLE ]') + ` [${moment().format('HH:mm:ss')}]: setCyclable ${codeVariant}=${isCyclable} oleh ${ctx.from}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in setCyclable: ${err.message}`);
    }
};

// ============================================
// .setcycleduration <codeVariant> <days>
// ============================================
const setCycleDuration = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(
                `*Cara pakai:*\n.setcycleduration <codeVariant> <hari>\n\nContoh:\n- .setcycleduration netflix1h 30 — 30 hari\n- .setcycleduration netflix1h 0 — hapus durasi`
            );
        }

        const codeVariant = args[0].trim().toLowerCase();
        const daysRaw = parseInt(args[1], 10);

        if (isNaN(daysRaw) || daysRaw < 0) {
            return ctx.reply('*Durasi harus angka >= 0*\n\nGunakan 0 untuk menghapus durasi.');
        }

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return ctx.reply(`*Variant tidak ditemukan:* ${codeVariant}`);
        }

        const durationDays = daysRaw === 0 ? null : daysRaw;
        await productVariantRepository.setDuration(ctx, codeVariant, durationDays);

        let responseText = `*Durasi Cycle diupdate: ${codeVariant}*\n\n`;
        if (durationDays) {
            responseText += `Durasi: *${durationDays} hari*\n`;
            responseText += `Artinya: Credentials akan bisa disiklus kembali setelah *${durationDays} hari* sejak pembelian.`;
        } else {
            responseText += `Durasi dihapus (null)\n`;
            responseText += `⚠️ Cycle tidak akan berjalan tanpa durasi yang diset.`;
        }

        await ctx.reply(responseText);

        console.log(clc.green.bold('[ CYCLE ]') + ` [${moment().format('HH:mm:ss')}]: setCycleDuration ${codeVariant}=${durationDays} oleh ${ctx.from}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in setCycleDuration: ${err.message}`);
    }
};

// No callback handlers needed for WhatsApp — confirmation is done via text commands
// (e.g., `.cycle <id> confirm` and `.cyclebulk confirm`)

module.exports = {
    rekapCycle,
    cekSiklus,
    cycleOrder,
    cyclebulkCommand,
    setCyclable,
    setCycleDuration
};
