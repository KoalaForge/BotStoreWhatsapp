const transactionRepository = require('../../repositories/TransactionRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const productRepository = require('../../repositories/ProductRepository');
const resellerService = require('../../services/resellerService');
const moment = require('moment-timezone');

/**
 * Resolve product name from variant code (handles both normal and reseller).
 */
async function resolveProductName(ctx, variantCode) {
    // Try owner-scoped variant first
    const variant = await productVariantRepository.findByCodeVariant(ctx, variantCode);
    if (variant) {
        const product = await productRepository.findByCode(ctx, variant.code);
        if (product) return `${product.name} — ${variant.name}`;
    }
    // Fall back to platform variant (reseller)
    const result = await resellerService.resolveVariantFromCallback(ctx, variantCode);
    if (result) {
        const displayName = result.config?.custom_name || result.platformVariant?.name;
        return `${result.resellerProduct.name} — ${displayName}`;
    }
    return 'Produk tidak ditemukan';
}

/**
 * Show transaction history type selection
 */
const showTransactionHistory = async (ctx) => {
    try {
        const message = '*Riwayat Transaksi*\n\n_Pilih jenis riwayat:_\n\nKetik *riwayat pembelian* atau *riwayat deposit*';
        await ctx.reply(message);
    } catch (error) {
        console.error('Error in showTransactionHistory:', error);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
    }
};

/**
 * Show purchase (product) transaction history
 */
const showPurchaseHistory = async (ctx) => {
    try {
        const userId = ctx.from;

        // Get last 10 product transactions
        const transactions = await transactionRepository.find(ctx, {
            user_id: userId.toString(),
            isSuccess: true,
            isCanceled: false,
            $or: [
                { transaction_type: 'product' },
                { transaction_type: { $exists: false } }
            ]
        }, {
            sort: { createdAt: -1 },
            limit: 10
        });

        if (transactions.length === 0) {
            return ctx.reply('*Belum ada riwayat pembelian*');
        }

        let message = '*Riwayat Pembelian*\n\n';

        for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];

            const productName = txn.productCode
                ? await resolveProductName(ctx, txn.productCode)
                : 'Produk tidak ditemukan';

            const formattedDate = moment(txn.createdAt).tz('Asia/Jakarta').format('DD/MM/YY HH:mm');

            message += `*${i + 1}.* ${productName}\n`;
            message += `   ID: \`${txn.transactionId}\`\n`;
            message += `   ${txn.orderQuantity || '-'}x — Rp ${txn.totalPrice.toLocaleString('id-ID')}\n`;
            message += `   ${formattedDate} WIB\n\n`;
        }

        message += '_Ketik *riwayat pembelian semua* untuk export_';
        await ctx.reply(message);
    } catch (error) {
        console.error('Error in showPurchaseHistory:', error);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
    }
};

/**
 * Show deposit (topup) transaction history
 */
const showDepositHistory = async (ctx) => {
    try {
        const userId = ctx.from;

        // Get last 10 topup transactions
        const transactions = await transactionRepository.find(ctx, {
            user_id: userId.toString(),
            isSuccess: true,
            isCanceled: false,
            transaction_type: 'topup'
        }, {
            sort: { createdAt: -1 },
            limit: 10
        });

        if (transactions.length === 0) {
            return ctx.reply('*Belum ada riwayat deposit*');
        }

        let message = '*Riwayat Deposit*\n\n';

        for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];
            const formattedDate = moment(txn.createdAt).tz('Asia/Jakarta').format('DD/MM/YY HH:mm');

            message += `*${i + 1}.* \`${txn.transactionId}\`\n`;
            message += `   Rp ${txn.totalPrice.toLocaleString('id-ID')}\n`;
            message += `   ${formattedDate} WIB\n\n`;
        }

        message += '_Ketik *riwayat deposit semua* untuk export_';
        await ctx.reply(message);
    } catch (error) {
        console.error('Error in showDepositHistory:', error);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
    }
};

/**
 * Export all purchase history to txt file
 */
const exportPurchaseHistory = async (ctx) => {
    try {
        const userId = ctx.from;

        const transactions = await transactionRepository.find(ctx, {
            user_id: userId.toString(),
            isSuccess: true,
            isCanceled: false,
            $or: [
                { transaction_type: 'product' },
                { transaction_type: { $exists: false } }
            ]
        }, {
            sort: { createdAt: -1 }
        });

        if (transactions.length === 0) {
            return ctx.reply('*Belum ada riwayat pembelian untuk diekspor*');
        }

        let content = `RIWAYAT TRANSAKSI PEMBELIAN\nTotal: ${transactions.length} transaksi\n\n`;

        for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];

            const productName = txn.productCode
                ? await resolveProductName(ctx, txn.productCode)
                : 'Produk tidak ditemukan';

            const formattedDate = moment(txn.createdAt).tz('Asia/Jakarta').format('DD/MM/YY HH:mm');

            content += `${i + 1}. ${productName}\n`;
            content += `   ID: ${txn.transactionId}\n`;
            content += `   ${txn.orderQuantity || '-'}x — Rp ${txn.totalPrice.toLocaleString('id-ID')}\n`;
            content += `   ${formattedDate} WIB\n\n`;
        }

        const timestamp = moment().format('YYYYMMDDHHmmss');
        const filename = `transactions_pembelian_${timestamp}.txt`;
        const buffer = Buffer.from(content, 'utf8');

        await ctx.sendDocument(
            buffer,
            filename,
            `*Riwayat Pembelian Lengkap*\n\nTotal: ${transactions.length} transaksi`,
            'text/plain'
        );

    } catch (error) {
        console.error('Error in exportPurchaseHistory:', error);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
    }
};

/**
 * Export all deposit history to txt file
 */
const exportDepositHistory = async (ctx) => {
    try {
        const userId = ctx.from;

        // Get all topup transactions
        const transactions = await transactionRepository.find(ctx, {
            user_id: userId.toString(),
            isSuccess: true,
            isCanceled: false,
            transaction_type: 'topup'
        }, {
            sort: { createdAt: -1 }
        });

        if (transactions.length === 0) {
            return ctx.reply('*Belum ada riwayat deposit untuk diekspor*');
        }

        let content = `RIWAYAT TRANSAKSI DEPOSIT\nTotal: ${transactions.length} transaksi\n\n`;

        for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];
            const formattedDate = moment(txn.createdAt).tz('Asia/Jakarta').format('DD/MM/YY HH:mm');

            content += `${i + 1}. ${txn.transactionId}\n`;
            content += `   Rp ${txn.totalPrice.toLocaleString('id-ID')}\n`;
            content += `   ${formattedDate} WIB\n\n`;
        }

        const timestamp = moment().format('YYYYMMDDHHmmss');
        const filename = `transactions_deposit_${timestamp}.txt`;
        const buffer = Buffer.from(content, 'utf8');

        await ctx.sendDocument(
            buffer,
            filename,
            `*Riwayat Deposit Lengkap*\n\nTotal: ${transactions.length} transaksi`,
            'text/plain'
        );

    } catch (error) {
        console.error('Error in exportDepositHistory:', error);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
    }
};

module.exports = {
    showTransactionHistory,
    showPurchaseHistory,
    showDepositHistory,
    exportPurchaseHistory,
    exportDepositHistory
};
