const clc = require('cli-color');
const moment = require('moment-timezone');
const transactionRepository = require('../../repositories/TransactionRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const productRepository = require('../../repositories/ProductRepository');
const orderTransactionItemService = require('../../services/orderTransactionItemService');
const { formatMoney } = require('../../database/models/money');
const { requireAdmin } = require('../../middleware/waAuth');

async function resolveProductDetails(ctx, productCode) {
    if (!productCode) return { productName: 'N/A', variantName: 'N/A' };
    try {
        const variant = await productVariantRepository.findByCodeVariant(ctx, productCode);
        if (!variant) return { productName: 'N/A', variantName: 'N/A' };
        const product = await productRepository.findByCode(ctx, variant.code);
        return {
            productName: product?.name || 'N/A',
            variantName: variant.name || 'N/A'
        };
    } catch (err) {
        console.log(clc.yellow.bold("[ WARNING ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Failed to fetch product details: ${err.message}`)}`);
        return { productName: 'N/A', variantName: 'N/A' };
    }
}

/**
 * Check detailed transaction information (WhatsApp version).
 * Usage: .checktransaction <transaction_id>
 */
const checkTransaction = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 1) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.checktransaction <TRANSACTION_ID>`\n\n' +
                '*Contoh:*\n' +
                '`.checktransaction TRX123456789`\n' +
                '`.checktransaction TOPUP987654321`'
            );
        }

        const transactionId = args.join(' ').trim();

        if (!transactionId) {
            return ctx.reply('*Transaction ID tidak boleh kosong!*');
        }

        const transaction = await transactionRepository.findByTransactionId(ctx, transactionId);

        if (!transaction) {
            return ctx.reply(
                `*Transaksi tidak ditemukan!*\n\n` +
                `Transaction ID \`${transactionId}\` tidak ada dalam database.\n\n` +
                `_Pastikan ID transaksi yang dimasukkan benar._`
            );
        }

        // Format status
        const statusParts = [];
        if (transaction.isSuccess) statusParts.push('Success');
        if (transaction.isCanceled) statusParts.push('Canceled');
        if (transaction.isDelivered) statusParts.push('Delivered');
        if (transaction.isReminded) statusParts.push('Reminded');
        if (!transaction.isSuccess && !transaction.isCanceled) statusParts.push('Pending');
        const statusText = statusParts.join(' / ');

        const typeText = transaction.transaction_type === 'product' ? 'Product' : 'Top-Up';
        const paymentText = transaction.payment_method_code.toUpperCase();

        let msg = `*Detail Transaksi*\n\n`;

        // Basic info
        msg += `*Informasi Dasar*\n`;
        msg += `*Transaction ID:* \`${transaction.transactionId}\`\n`;

        if (transaction.is_reseller_order && transaction.platform_reference) {
            msg += `*Platform TX ID:* \`${transaction.platform_reference}\`\n`;
        }

        msg += `*Type:* ${typeText}\n`;
        msg += `*Payment Method:* ${paymentText}\n`;
        msg += `*Status:* ${statusText}\n`;
        msg += `*Created:* ${moment(transaction.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB\n`;
        msg += `*Updated:* ${moment(transaction.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB\n\n`;

        // Customer info
        msg += `*Informasi Customer*\n`;
        msg += `*User ID:* \`${transaction.user_id}\`\n`;
        msg += `*Chat ID:* \`${transaction.chatId}\`\n\n`;

        // Product info
        if (transaction.transaction_type === 'product') {
            msg += `*Informasi Produk*\n`;
            const { productName, variantName } = await resolveProductDetails(ctx, transaction.productCode);
            msg += `*Product Name:* ${productName}\n`;
            msg += `*Variant Name:* ${variantName}\n`;
            if (transaction.orderQuantity) {
                msg += `*Quantity:* ${transaction.orderQuantity} item\n`;
            }
            if (transaction.buyer_notes) {
                msg += `*Pesan untuk Seller:*\n  ${transaction.buyer_notes}\n`;
            }
            msg += `\n`;
        }

        // Transaction items
        const transactionItems = await orderTransactionItemService.getTransactionItems(ctx, transaction.transactionId);

        // Financial info
        msg += `*Informasi Keuangan*\n`;
        msg += `*Total Price:* ${formatMoney(transaction.totalPrice)}\n`;
        msg += `*Fee/Tax:* ${formatMoney(transaction.payment_fee)}\n`;
        msg += `*Profit:* ${formatMoney(transaction.profit)}\n`;

        if (transaction.voucherCode) {
            msg += `*Voucher Code:* \`${transaction.voucherCode}\`\n`;
            msg += `*Voucher Discount:* ${formatMoney(transaction.voucherDiscount)}\n`;
        }

        if (transactionItems && transactionItems.length > 0) {
            for (const item of transactionItems) {
                if (item.unit_price != null) {
                    msg += `*Unit Price (${item.variant_name}):* ${formatMoney(item.unit_price)}\n`;
                }
                if (item.cost_price != null) {
                    msg += `*Cost Price (${item.variant_name}):* ${formatMoney(item.cost_price)}\n`;
                }
                if (item.data && Array.isArray(item.data) && item.data.length > 0) {
                    msg += `*Data (${item.variant_name}):*\n`;
                    for (let i = 0; i < item.data.length; i++) {
                        const stockItem = item.data[i];
                        const stockLabel = item.data.length > 1 ? ` [${i + 1}/${item.data.length}]` : '';
                        msg += `  Item${stockLabel}:\n\`\`\`\n${stockItem.dataStock}\n\`\`\`\n`;
                    }
                }
            }
        }
        msg += `\n`;

        // Order data
        if (transaction.orderData && transaction.orderData.trim() !== '') {
            msg += `*Order Data*\n\`\`\`\n${transaction.orderData}\n\`\`\`\n\n`;
        }

        // Timeline
        msg += `*Timeline*\n`;
        msg += `*Transaction Date:* ${transaction.formattedDate}\n`;
        msg += `*Created:* ${moment(transaction.createdAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB\n`;
        msg += `*Last Update:* ${moment(transaction.updatedAt).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss')} WIB\n`;

        const duration = moment(transaction.updatedAt).diff(moment(transaction.createdAt), 'minutes');
        msg += `*Duration:* ${duration} menit\n\n`;

        msg += `_Detail transaksi berhasil dimuat_`;

        await ctx.reply(msg);

        console.log(clc.green.bold("[ SUCCESS ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Admin ${ctx.from} checked transaction ${transactionId}`)}`);

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/privateCommand/checkTransaction.js: ${err.message}`)}`);
    }
};

module.exports = checkTransaction;
