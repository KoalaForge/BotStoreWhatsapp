'use strict';

const clc = require('cli-color');
const moment = require('moment-timezone');
const orderTransactionItemRepository = require('../repositories/OrderTransactionItemRepository');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const stockRepository = require('../repositories/StockRepository');
const transactionRepository = require('../repositories/TransactionRepository');

/**
 * Get cycle summary for admin dashboard
 * @param {Object} ctx - Telegraf context
 * @param {Object} [filter] - Optional filter (e.g. { codeVariant: 'net7d' })
 * @returns {Promise<Object>} { completedToday, upcoming, overdue, failed, stuck }
 */
async function getCycleSummary(ctx, filter = {}) {
    return await orderTransactionItemRepository.getCycleSummary(ctx, filter);
}

/**
 * Get cycle status for items in a specific transaction
 * @param {Object} ctx - Telegraf context
 * @param {string} transactionId - Human-readable transaction ID (e.g., "INV-xxx")
 * @returns {Promise<{transaction: Object, items: Array}|{error: string}>}
 */
async function getOrderCycleStatus(ctx, transactionId) {
    const transaction = await transactionRepository.findByTransactionId(ctx, transactionId);
    if (!transaction) {
        return { error: 'transaction_not_found' };
    }

    const items = await orderTransactionItemRepository.findCyclableItemsByTransaction(ctx, transaction._id);

    return { transaction, items };
}

/**
 * Perform manual cycle for all eligible items in a transaction
 * Only cycles items with cycle_eligible_at != null AND cycled_at == null AND data.length > 0
 * Uses CAS pattern to prevent double-cycling
 *
 * @param {Object} ctx - Telegraf context
 * @param {string} transactionId - Human-readable transaction ID
 * @returns {Promise<{success: number, alreadyCycled: number, failed: number, total: number, error?: string}>}
 */
async function manualCycleTransaction(ctx, transactionId) {
    const transaction = await transactionRepository.findByTransactionId(ctx, transactionId);
    if (!transaction) {
        return { error: 'transaction_not_found' };
    }

    const items = await orderTransactionItemRepository.findCyclableItemsByTransaction(ctx, transaction._id);

    const eligibleItems = items.filter(item =>
        item.cycle_eligible_at !== null &&
        item.cycled_at === null &&
        Array.isArray(item.data) && item.data.length > 0
    );

    if (eligibleItems.length === 0) {
        return { error: 'no_eligible_items', total: items.length };
    }

    const results = { success: 0, alreadyCycled: 0, failed: 0, total: eligibleItems.length };

    for (const item of eligibleItems) {
        try {
            // CAS: set cycled_at only if currently null (prevents double-cycling)
            const updateResult = await orderTransactionItemRepository.markAsCycled(item._id);

            if (updateResult.modifiedCount === 0) {
                // Race condition — already cycled by backend or another request
                results.alreadyCycled++;
                continue;
            }

            // Safely insert valid credentials back to stock
            try {
                const now = new Date();
                // Fallback for legacy items whose data snapshot predates ownerId capture
                const variant = await productVariantRepository.findByCodeVariant(ctx, item.codeVariant);
                for (const record of item.data) {
                    // Partial expiry: skip records with expired expires_at
                    if (record.expires_at && new Date(record.expires_at) <= now) continue;

                    const expiresAt = record.expires_at ?? null;
                    const ownerId = record.ownerId ?? variant?.ownerId ?? null;

                    if (ownerId === null) {
                        // Platform stock (reseller orders, ownerId=null)
                        await stockRepository.addPlatformStock(item.codeVariant, record.dataStock, record.profit ?? 0, expiresAt);
                    } else {
                        await stockRepository.addStock(ctx, item.codeVariant, record.dataStock, record.profit ?? 0, expiresAt);
                    }
                }
                results.success++;
            } catch (stockErr) {
                // Stock insertion failed — rollback cycled_at so backend can retry
                await orderTransactionItemRepository.model.updateOne(
                    { _id: item._id },
                    { $unset: { cycled_at: 1 }, $set: { cycle_failed: true }, $inc: { cycle_retry_count: 1 } }
                );
                results.failed++;
                console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Stock insert failed for item ${item._id}: ${stockErr.message}`);
            }
        } catch (err) {
            results.failed++;
            console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error cycling item ${item._id}: ${err.message}`);
        }
    }

    return results;
}

/**
 * Set cycle_eligible_at on transaction items when a cyclable order is paid
 * Called by delivery/payment processing service after successful payment
 *
 * @param {Object} context - Repository context (botId, ownerId, mode) or Telegraf ctx
 * @param {string} transactionObjectId - Transaction _id as string (order_transaction_id value in items)
 * @param {Date} paidAt - When the transaction was paid
 * @returns {Promise<number>} - Number of items updated
 */
async function setCycleEligibilityForItems(context, transactionObjectId, paidAt) {
    try {
        // Get all items for this transaction
        const items = await orderTransactionItemRepository.findByTransactionObjectId(context, transactionObjectId);

        let updated = 0;

        for (const item of items) {
            // Look up variant to check is_cyclable and duration_days
            const variant = await productVariantRepository.findByCodeVariant(context, item.codeVariant);

            if (!variant || !variant.is_cyclable || !variant.duration_days) {
                continue; // Skip non-cyclable items
            }

            // Calculate cycle_eligible_at = paid_at + duration_days
            const eligibleAt = new Date(paidAt.getTime());
            eligibleAt.setDate(eligibleAt.getDate() + variant.duration_days);

            await orderTransactionItemRepository.updateOneUnscoped(
                { _id: item._id },
                { $set: { cycle_eligible_at: eligibleAt } }
            );

            updated++;
        }

        return updated;
    } catch (err) {
        console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error setting cycle eligibility: ${err.message}`);
        return 0;
    }
}

/**
 * Bulk cycle ALL eligible items (past due, cycled_at == null, has data)
 * Processes all items across all transactions without specifying a transaction ID
 * Uses same CAS pattern as manualCycleTransaction to prevent double-cycling
 *
 * @param {Object} ctx - Telegraf context
 * @returns {Promise<{success: number, alreadyCycled: number, failed: number, total: number}>}
 */
async function bulkCycleEligible(ctx) {
    const items = await orderTransactionItemRepository.findAllEligibleForBulkCycle(ctx);

    const eligibleItems = items.filter(item =>
        Array.isArray(item.data) && item.data.length > 0
    );

    if (eligibleItems.length === 0) {
        return { success: 0, alreadyCycled: 0, failed: 0, total: 0 };
    }

    const results = { success: 0, alreadyCycled: 0, failed: 0, total: eligibleItems.length };

    for (const item of eligibleItems) {
        try {
            const updateResult = await orderTransactionItemRepository.markAsCycled(item._id);

            if (updateResult.modifiedCount === 0) {
                results.alreadyCycled++;
                continue;
            }

            try {
                const now = new Date();
                // Fallback for legacy items whose data snapshot predates ownerId capture
                const variant = await productVariantRepository.findByCodeVariant(ctx, item.codeVariant);
                for (const record of item.data) {
                    // Partial expiry: skip records with expired expires_at
                    if (record.expires_at && new Date(record.expires_at) <= now) continue;

                    const expiresAt = record.expires_at ?? null;
                    const ownerId = record.ownerId ?? variant?.ownerId ?? null;

                    if (ownerId === null) {
                        await stockRepository.addPlatformStock(item.codeVariant, record.dataStock, record.profit ?? 0, expiresAt);
                    } else {
                        await stockRepository.addStock(ctx, item.codeVariant, record.dataStock, record.profit ?? 0, expiresAt);
                    }
                }
                results.success++;
            } catch (stockErr) {
                await orderTransactionItemRepository.model.updateOne(
                    { _id: item._id },
                    { $unset: { cycled_at: 1 }, $set: { cycle_failed: true }, $inc: { cycle_retry_count: 1 } }
                );
                results.failed++;
                console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Stock insert failed for item ${item._id}: ${stockErr.message}`);
            }
        } catch (err) {
            results.failed++;
            console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error cycling item ${item._id}: ${err.message}`);
        }
    }

    return results;
}

/**
 * Get overdue cycle items with parent transaction info for admin dashboard
 * @param {Object} ctx - Telegraf context
 * @param {number} limit - Max items to return (default 10)
 * @returns {Promise<Array>} - Items with transactionId and user_id
 */
async function getEligibleWithTransactionInfo(ctx, limit = 10, filter = {}) {
    return await orderTransactionItemRepository.findOverdueWithTransactionInfo(ctx, limit, filter);
}

/**
 * Get upcoming (not yet due) cycle items with parent transaction info
 * @param {Object} ctx - Telegraf context
 * @param {number} limit - Max items to return (default 10)
 * @returns {Promise<Array>} - Items with transactionId and user_id
 */
async function getIncomingWithTransactionInfo(ctx, limit = 10, filter = {}) {
    return await orderTransactionItemRepository.findIncomingWithTransactionInfo(ctx, limit, filter);
}

/**
 * Get recently cycled items with parent transaction info (newest first)
 * @param {Object} ctx - Telegraf context
 * @param {number} limit - Max items to return (default 10)
 * @returns {Promise<Array>} - Items with transactionId, user_id, and full data
 */
async function getRecentlyCycledWithTransactionInfo(ctx, limit = 10, filter = {}) {
    return await orderTransactionItemRepository.findRecentlyCycledWithTransactionInfo(ctx, limit, filter);
}

/**
 * Convenience wrapper: resolve transaction by transactionId string then set cycle eligibility.
 * Used by pullStock and confirmPayBalance which know the transactionId but not the ObjectId.
 *
 * @param {Object} ctx - Telegraf context
 * @param {string} transactionId - Human-readable transaction ID (e.g., "INV-xxx")
 * @param {Date} paidAt - When the transaction was paid
 * @returns {Promise<number>} - Number of items updated
 */
async function setCycleEligibilityByTransactionId(ctx, transactionId, paidAt) {
    try {
        const transaction = await transactionRepository.findByTransactionId(ctx, transactionId);
        if (!transaction) return 0;
        return await setCycleEligibilityForItems(ctx, transaction._id.toString(), paidAt);
    } catch (err) {
        console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error in setCycleEligibilityByTransactionId for ${transactionId}: ${err.message}`);
        return 0;
    }
}

/**
 * Set cycle_eligible_at on platform record items (reseller order path)
 * Called after createPlatformRecord — platform items have botId=null/ownerId=null,
 * so DualScoped repository can't be used; uses findAllUnscoped + model direct access.
 *
 * Platform item.codeVariant = reseller product code (not useful for lookup).
 * Actual platform variant code lives in item.data[0].codeVariant (per stock record).
 *
 * @param {string|ObjectId} platformRecordId - Platform record _id
 * @param {Date} paidAt - When the transaction was paid
 * @returns {Promise<number>} - Number of items updated
 */
async function setCycleEligibilityForPlatformItems(platformRecordId, paidAt) {
    try {
        const items = await orderTransactionItemRepository.findAllUnscoped({
            order_transaction_id: platformRecordId.toString()
        });

        let updated = 0;

        for (const item of items) {
            // Platform items store the platform variant code in each data record,
            // not in item.codeVariant (which holds the reseller product code)
            const platformVariantCode = item.data?.[0]?.codeVariant;
            if (!platformVariantCode) continue;

            // Direct model lookup — bypass OwnerScoped since platform variants
            // may have a different ownerId than the current context
            const variant = await productVariantRepository.model.findOne({
                codeVariant: platformVariantCode
            }).lean();

            if (!variant || !variant.is_cyclable || !variant.duration_days) continue;

            const eligibleAt = new Date(paidAt.getTime());
            eligibleAt.setDate(eligibleAt.getDate() + variant.duration_days);

            await orderTransactionItemRepository.updateOneUnscoped(
                { _id: item._id },
                { $set: { cycle_eligible_at: eligibleAt } }
            );

            updated++;
        }

        return updated;
    } catch (err) {
        console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error setting cycle eligibility for platform items: ${err.message}`);
        return 0;
    }
}

/**
 * Clear cycle_eligible_at for items in a transaction (called on cancel/restore)
 * Prevents backend from cycling items whose stock was already manually restored
 *
 * @param {string} transactionObjectId - Transaction _id as string
 * @returns {Promise<void>}
 */
async function clearCycleEligibilityForItems(transactionObjectId) {
    try {
        await orderTransactionItemRepository.model.updateMany(
            { order_transaction_id: transactionObjectId.toString(), cycle_eligible_at: { $ne: null }, cycled_at: null },
            { $set: { cycle_eligible_at: null } }
        );
    } catch (err) {
        console.log(clc.red.bold('[ CYCLE ERROR ]') + ` [${moment().format('HH:mm:ss')}]: Error clearing cycle eligibility: ${err.message}`);
    }
}

module.exports = {
    getCycleSummary,
    getOrderCycleStatus,
    manualCycleTransaction,
    bulkCycleEligible,
    getEligibleWithTransactionInfo,
    getIncomingWithTransactionInfo,
    getRecentlyCycledWithTransactionInfo,
    setCycleEligibilityForItems,
    setCycleEligibilityByTransactionId,
    setCycleEligibilityForPlatformItems,
    clearCycleEligibilityForItems
};
