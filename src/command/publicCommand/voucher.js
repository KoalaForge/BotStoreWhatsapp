/**
 * Public Voucher Command (WhatsApp)
 * Shows list of active vouchers to customers
 */

const voucherService = require('../../services/voucherService');
const moment = require('moment-timezone');

async function voucherCommand(ctx) {
    try {
        // Get only active vouchers
        const vouchers = await voucherService.getAllVouchers(ctx, true);

        if (!vouchers || vouchers.length === 0) {
            return ctx.reply(
                '*Daftar Voucher*\n\n' +
                'Saat ini tidak ada voucher yang tersedia.\n\n' +
                '_Pantau terus untuk penawaran menarik!_'
            );
        }

        const validVouchers = vouchers.filter(v => v.isValid());

        if (validVouchers.length === 0) {
            return ctx.reply(
                '*Daftar Voucher*\n\n' +
                'Saat ini tidak ada voucher yang tersedia.\n\n' +
                '_Pantau terus untuk penawaran menarik!_'
            );
        }

        let message = '*Daftar Voucher*\n\n';

        validVouchers.forEach((voucher, index) => {
            message += `*${index + 1}. ${voucher.code}*\n`;

            if (voucher.discount_type === 'percentage') {
                let discountText = `   Diskon: ${voucher.discount_value}%`;
                if (voucher.max_discount_amount > 0) {
                    discountText += ` (maks Rp ${voucher.max_discount_amount.toLocaleString('id-ID')})`;
                }
                message += discountText + '\n';
            } else {
                message += `   Diskon: Rp ${voucher.discount_value.toLocaleString('id-ID')}\n`;
            }

            if (voucher.min_order_amount > 0) {
                message += `   _Min. order: Rp ${voucher.min_order_amount.toLocaleString('id-ID')}_\n`;
            }

            if (voucher.max_uses) {
                const remaining = voucher.max_uses - voucher.used_count;
                message += `   _Kuota: ${remaining}/${voucher.max_uses}_\n`;
            }

            if (voucher.end_date) {
                const endDate = moment(voucher.end_date).tz('Asia/Jakarta').format('DD/MM/YYYY');
                message += `   _Berlaku s/d: ${endDate}_\n`;
            }

            if (voucher.description) {
                message += `   _${voucher.description}_\n`;
            }

            message += '\n';
        });

        message += '\n*Cara Pakai*\n';
        message += '> Pilih produk yang ingin dibeli\n';
        message += '> Ketik "voucher" saat di halaman order\n';
        message += '> Masukkan kode voucher\n';
        message += '> Diskon otomatis diterapkan\n\n';
        message += '_Gunakan voucher sebelum masa berlaku habis._';

        await ctx.reply(message);

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            command: '.voucher',
            error: err.message,
            stack: err.stack
        });

        await ctx.reply(
            '*Gagal menampilkan voucher*\n\nTerjadi kesalahan. Silakan coba lagi nanti.'
        );
    }
}

module.exports = voucherCommand;
