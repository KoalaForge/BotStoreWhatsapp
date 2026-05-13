const { requireAdmin } = require('../../middleware/waAuth');
const voucherService = require('../../services/voucherService');
const productRepository = require('../../repositories/ProductRepository');
const { isDuplicateKeyError, sanitizeErrorMessage } = require('../../utils/errorSanitizer');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * Parse description and remaining params from input tokens
 * Description can be quoted (e.g., "Diskon Summer")
 */
function parseDescriptionFromInput(input) {
    let remainingParams = input.slice(7);

    if (remainingParams.length === 0 || !remainingParams[0].startsWith('"')) {
        return { description: '', remainingParams };
    }

    const descStartIndex = input.indexOf(remainingParams[0]);
    const fullText = input.slice(descStartIndex).join(' ');
    const descMatch = fullText.match(/"([^"]*)"/);

    if (!descMatch) {
        return { description: '', remainingParams };
    }

    const afterDesc = fullText.substring(descMatch[0].length).trim().split(' ');
    return {
        description: descMatch[1],
        remainingParams: afterDesc.filter(p => p)
    };
}

const addVoucher = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const input = ctx.message.split(' ');

        if (input.length < 5) {
            return ctx.reply(
                `*Format salah*\n\n` +
                `Format:\n` +
                `.addvoucher <CODE> <fixed|percentage> <value> <max_uses> [max_discount] [min_order] [description] [start_date] [end_date]\n\n` +
                `Contoh 1 (Percentage):\n` +
                `.addvoucher SUMMER2024 percentage 10 100 5000 100000 "Diskon Summer" 2025-06-01 2025-08-31\n\n` +
                `Contoh 2 (Fixed):\n` +
                `.addvoucher NEWUSER fixed 50000 50 0 0 "Diskon User Baru"\n\n` +
                `Keterangan:\n` +
                `- CODE: Kode voucher (uppercase)\n` +
                `- Type: fixed atau percentage\n` +
                `- Value: Nominal (untuk fixed) atau angka persen (untuk percentage)\n` +
                `- Max Uses: Maksimal penggunaan (0 = unlimited)\n` +
                `- Max Discount: Cap maksimal diskon untuk percentage (opsional)\n` +
                `- Min Order: Minimum pembelian (opsional)\n` +
                `- Description: Deskripsi (gunakan "quotes", opsional)\n` +
                `- Start Date: Tanggal mulai YYYY-MM-DD (opsional)\n` +
                `- End Date: Tanggal berakhir YYYY-MM-DD (opsional)`
            );
        }

        const code = input[1].toUpperCase().trim();
        const discountType = input[2].toLowerCase();
        const discountValue = parseInt(input[3]);
        const maxUses = parseInt(input[4]) || null;

        const maxDiscountAmount = input[5] ? parseInt(input[5]) : 0;
        const minOrderAmount = input[6] ? parseInt(input[6]) : 0;

        const { description, remainingParams } = parseDescriptionFromInput(input);

        let startDate = null;
        let endDate = null;
        if (remainingParams.length > 0) startDate = remainingParams[0];
        if (remainingParams.length > 1) endDate = remainingParams[1];

        if (!['fixed', 'percentage'].includes(discountType)) {
            return ctx.reply(
                `*Tipe diskon tidak valid*\n\nTipe diskon harus "fixed" atau "percentage"`
            );
        }

        if (isNaN(discountValue) || discountValue <= 0) {
            return ctx.reply(
                `*Nilai diskon tidak valid*\n\nNilai diskon harus angka positif`
            );
        }

        if (discountType === 'percentage' && discountValue > 100) {
            return ctx.reply(
                `*Persentase tidak valid*\n\nPersentase diskon tidak boleh lebih dari 100%`
            );
        }

        // Show reseller warning BEFORE creation if owner has reseller products
        const resellerProducts = await productRepository.find(ctx, { reseller_source_code: { $ne: null } });
        if (resellerProducts.length > 0) {
            await ctx.reply(
                `*Info Reseller:* Bot Anda memiliki ${resellerProducts.length} produk reseller. ` +
                `Untuk produk reseller, diskon voucher akan dibatasi maksimal sebesar margin keuntungan Anda per produk. ` +
                `Voucher dengan diskon melebihi margin akan otomatis disesuaikan saat checkout.`
            );
        }

        const voucherData = {
            code,
            discount_type: discountType,
            discount_value: discountValue,
            max_uses: maxUses,
            max_discount_amount: maxDiscountAmount,
            min_order_amount: minOrderAmount,
            description,
            start_date: startDate,
            end_date: endDate,
            is_active: true
        };

        const voucher = await voucherService.createVoucher(ctx, voucherData);

        let discountText = '';
        if (discountType === 'percentage') {
            discountText = `${discountValue}%`;
            if (maxDiscountAmount > 0) {
                discountText += ` (Max Rp ${maxDiscountAmount.toLocaleString('id-ID')})`;
            }
        } else {
            discountText = `Rp ${discountValue.toLocaleString('id-ID')}`;
        }

        const usageText = maxUses ? `${maxUses} kali` : 'Unlimited';
        const minOrderText = minOrderAmount > 0 ? `Rp ${minOrderAmount.toLocaleString('id-ID')}` : 'Tidak ada';

        let periodText = '';
        if (startDate || endDate) {
            const start = startDate ? moment(startDate).format('DD/MM/YYYY') : '-';
            const end = endDate ? moment(endDate).format('DD/MM/YYYY') : '-';
            periodText = `${start} - ${end}`;
        } else {
            periodText = 'Tidak terbatas';
        }

        await ctx.reply(
            `*Voucher berhasil dibuat*\n\n` +
            `*Kode:* ${voucher.code}\n` +
            `*Diskon:* ${discountText}\n` +
            `*Max Penggunaan:* ${usageText}\n` +
            `*Min. Pembelian:* ${minOrderText}\n` +
            `*Periode:* ${periodText}\n` +
            (description ? `*Deskripsi:* ${description}\n` : '') +
            `\n_Voucher sudah aktif dan siap digunakan._`
        );

        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Voucher ${voucher.code} created by admin ${ctx.from}`));

    } catch (err) {
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Error in addVoucher: ${err.message}`));

        let userMessage;
        if (isDuplicateKeyError(err) || err.message === 'Kode voucher sudah digunakan') {
            userMessage = `Kode voucher sudah ada. Gunakan kode lain.`;
        } else {
            userMessage = sanitizeErrorMessage(err);
        }

        await ctx.reply(`*Gagal membuat voucher*\n\n${userMessage}`);
    }
};

module.exports = addVoucher;
