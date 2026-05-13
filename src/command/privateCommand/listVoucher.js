const { requireAdmin } = require('../../middleware/waAuth');
const voucherService = require('../../services/voucherService');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');
const clc = require('cli-color');
const moment = require('moment-timezone');

const listVoucher = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const vouchers = await voucherService.getAllVouchers(ctx);

        if (!vouchers || vouchers.length === 0) {
            return ctx.reply(
                `*Belum ada voucher*\n\nGunakan .addvoucher untuk membuat voucher baru`
            );
        }

        let message = `*Daftar Voucher*\n\n` +
            `*Total:* ${vouchers.length} voucher\n\n`;

        const activeVouchers = vouchers.filter(v => v.is_active);
        const inactiveVouchers = vouchers.filter(v => !v.is_active);

        if (activeVouchers.length > 0) {
            message += `*Voucher Aktif (${activeVouchers.length})*\n\n`;
            activeVouchers.forEach(voucher => {
                message += formatVoucherInfoWA(voucher);
                message += `\n`;
            });
        }

        if (inactiveVouchers.length > 0) {
            message += `\n*Voucher Tidak Aktif (${inactiveVouchers.length})*\n\n`;
            inactiveVouchers.forEach(voucher => {
                message += formatVoucherInfoWA(voucher);
                message += `\n`;
            });
        }

        message += `\n_Gunakan .activatevoucher atau .deactivatevoucher untuk mengubah status_`;

        // Split message if too long (WhatsApp limit ~65536 but keep it readable)
        if (message.length > 4000) {
            const chunks = [];
            let currentChunk = `*Daftar Voucher*\n\n*Total:* ${vouchers.length} voucher\n\n`;

            vouchers.forEach(voucher => {
                const voucherBlock = formatVoucherInfoWA(voucher) + `\n`;

                if ((currentChunk + voucherBlock).length > 4000) {
                    chunks.push(currentChunk);
                    currentChunk = `*Daftar Voucher (lanjutan)*\n\n`;
                }

                currentChunk += voucherBlock;
            });

            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }

            for (const chunk of chunks) {
                await ctx.reply(chunk);
            }
        } else {
            await ctx.reply(message);
        }

        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Admin ${ctx.from} viewed voucher list`));

    } catch (err) {
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in listVoucher: ${err.message}`));

        await ctx.reply(`*Gagal menampilkan voucher*\n\n${sanitizeErrorMessage(err)}`);
    }
};

/**
 * Format single voucher info for WhatsApp markdown
 */
function formatVoucherInfoWA(voucher) {
    const isFullyValid = typeof voucher.isValid === 'function' ? voucher.isValid() : voucher.is_active;
    const status = isFullyValid ? '✅' : '❌';

    let text = `${status} *${voucher.code}*\n`;

    if (voucher.discount_type === 'percentage') {
        text += `   Diskon: ${voucher.discount_value}%`;
        if (voucher.max_discount_amount > 0) {
            text += ` (Max Rp ${voucher.max_discount_amount.toLocaleString('id-ID')})`;
        }
        text += '\n';
    } else {
        text += `   Diskon: Rp ${voucher.discount_value.toLocaleString('id-ID')}\n`;
    }

    if (voucher.min_order_amount > 0) {
        text += `   Min. order: Rp ${voucher.min_order_amount.toLocaleString('id-ID')}\n`;
    }

    if (voucher.max_uses) {
        text += `   Penggunaan: ${voucher.used_count || 0}/${voucher.max_uses}\n`;
    } else {
        text += `   Penggunaan: ${voucher.used_count || 0} (unlimited)\n`;
    }

    if (voucher.start_date || voucher.end_date) {
        const start = voucher.start_date ? moment(voucher.start_date).format('DD/MM/YYYY') : '-';
        const end = voucher.end_date ? moment(voucher.end_date).format('DD/MM/YYYY') : '-';
        text += `   Periode: ${start} - ${end}\n`;
    }

    if (voucher.description) {
        text += `   _${voucher.description}_\n`;
    }

    return text;
}

module.exports = listVoucher;
