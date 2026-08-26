const orderTransactionItemService = require('../services/orderTransactionItemService');
const addStocks = require('./addStocks');
const stockRepository = require('../repositories/StockRepository');
const ownerBalanceService = require('../services/ownerBalanceService');
const TransactionModel = require('../database/models/transactionModels');
const cycleService = require('../services/cycleService');

/**
 * Transaction Items Helper
 * Provides backward compatibility between new itemized structure and legacy orderData
 *
 * Purpose:
 * - Allow reading from either items (new) or orderData (legacy)
 * - Enable stock restoration from either source
 * - Ensure seamless transition without breaking existing transactions
 */

/**
 * Iterate transaction items that have data and invoke a restore function for each
 * @param {Array} items - Transaction items
 * @param {Function} restoreItemFn - Async function(item) to restore stock for a single item
 */
async function restoreItemsToStock(items, restoreItemFn) {
    for (const item of items) {
        if (!item.data || item.data.length === 0) continue;
        await restoreItemFn(item);
    }
}

async function restoreStockRecord(context, stockRecord, isPlatform) {
    if (stockRecord.stockSchemaVersion === 2 && stockRecord.reservationToken) {
        if (isPlatform) {
            await stockRepository.releasePlatformClaim(stockRecord._id, stockRecord.reservationToken);
        } else {
            await stockRepository.releaseClaim(context, stockRecord._id, stockRecord.reservationToken);
        }
        return;
    }

    const lineage = {
        unitCost: stockRecord.unitCost,
        stockBatchId: stockRecord.stockBatchId,
        stockOriginId: stockRecord.stockOriginId
    };

    if (isPlatform) {
        await stockRepository.addPlatformStock(stockRecord.codeVariant, stockRecord.dataStock, stockRecord.profit || 0, stockRecord.expires_at, lineage);
        return;
    }

    await stockRepository.addStock(context, stockRecord.codeVariant, stockRecord.dataStock, stockRecord.profit || 0, stockRecord.expires_at, lineage);
}

/**
 * Get order data from transaction (backward compatible)
 * Tries items first, falls back to orderData
 *
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {Object} transaction - Transaction document
 * @returns {Promise<Object>} - { source: 'items'|'orderData'|'none', orderData: string, items: array|null, profit: number }
 */
async function getOrderDataCompat(context, transaction) {
    // Try new structure first
    const items = await orderTransactionItemService.getTransactionItems(context, transaction.transactionId);

    if (items && items.length > 0) {
        const orderData = orderTransactionItemService.getOrderDataFromItems(items);
        const profit = orderTransactionItemService.calculateProfitFromItems(items);

        return {
            source: 'items',
            orderData: orderData,
            items: items,
            profit: profit
        };
    }

    // Fallback to legacy orderData
    if (transaction.orderData) {
        return {
            source: 'orderData',
            orderData: transaction.orderData,
            items: null,
            profit: transaction.profit || 0
        };
    }

    // No data available
    return {
        source: 'none',
        orderData: null,
        items: null,
        profit: 0
    };
}

/**
 * Restore stock from transaction (backward compatible)
 * Works with both itemized structure and legacy orderData
 *
 * @param {Object} context - Repository context (botId, ownerId, mode)
 * @param {Object} transaction - Transaction document to restore stock from
 * @returns {Promise<void>}
 */
async function restoreStockCompat(context, transaction) {
    // Only restore stock for product transactions
    if (transaction.transaction_type !== 'product') {
        return;
    }

    // RESELLER orders: restore to platform stock (ownerId=null)
    if (transaction.is_reseller_order) {
        const items = await orderTransactionItemService.getTransactionItems(context, transaction.transactionId);

        if (items && items.length > 0) {
            await restoreItemsToStock(items, async (item) => {
                for (const stockRecord of item.data) {
                    await restoreStockRecord(context, stockRecord, true);
                }
            });
        }

        // Refund owner balance if it was deducted
        if (transaction.balance_deducted && !transaction.balance_refunded) {
            const item = items?.[0];
            const costPrice = item?.cost_price || 0;
            const totalCost = costPrice * transaction.orderQuantity;

            if (totalCost > 0 && transaction.ownerId) {
                const productName = item?.product_name || 'Produk';
                const variantName = item?.variant_name || '';
                const quantity = transaction.orderQuantity || item?.quantity || 0;
                const productInfo = variantName ? `${productName} - ${variantName}` : productName;
                const description = `Refund: Pembelian stok ${productInfo} x${quantity} (${transaction.transactionId}) dibatalkan`;

                await ownerBalanceService.refundForCancelledOrder(transaction.ownerId, totalCost, {
                    transactionId: transaction.transactionId,
                    description
                });

                // CAS: mark as refunded (idempotent) — use direct model to bypass scoping
                await TransactionModel.updateOne(
                    { transactionId: transaction.transactionId, balance_refunded: { $ne: true } },
                    { $set: { balance_refunded: true } }
                );
            }
        }

        // Clear cycle eligibility on platform record items
        const platformRecord = await TransactionModel.findOne({
            platform_reference: transaction.transactionId,
            ownerId: null
        }).lean();
        if (platformRecord) {
            await cycleService.clearCycleEligibilityForItems(platformRecord._id.toString());
        }
        return;
    }

    // NORMAL orders: existing flow
    const items = await orderTransactionItemService.getTransactionItems(context, transaction.transactionId);

    if (items && items.length > 0) {
        await restoreItemsToStock(items, async (item) => {
            for (const stockRecord of item.data) {
                await restoreStockRecord(context, stockRecord, false);
            }
        });

        await cycleService.clearCycleEligibilityForItems(transaction._id.toString());
        return;
    }

    // Fallback to legacy orderData restoration
    if (transaction.orderData && transaction.productCode) {
        const profitPerUnit = (transaction.profit - (transaction.payment_fee || 0)) / transaction.orderQuantity;
        await addStocks(context, transaction.orderData, transaction.productCode, profitPerUnit);
    }
}

/**
 * Check if transaction has items
 * @param {Object} context - Repository context
 * @param {Object} transaction - Transaction document
 * @returns {Promise<boolean>}
 */
async function hasItems(context, transaction) {
    const items = await orderTransactionItemService.getTransactionItems(context, transaction.transactionId);
    return items && items.length > 0;
}

module.exports = {
    getOrderDataCompat,
    restoreStockCompat,
    hasItems
};
