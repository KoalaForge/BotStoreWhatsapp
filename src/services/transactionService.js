const transactionRepository = require('../repositories/TransactionRepository');
const botUserBalanceRepository = require('../repositories/BotUserBalanceRepository');
const TransactionModel = require('../database/models/transactionModels');
const OrderTransactionItemModel = require('../database/models/orderTransactionItemsModels');
const modeService = require('./modeService');
const addStocks = require('../utils/addStocks');
const { generateTransactionId, generatePlatformTransactionId } = require('../utils/generateTransactionId');

class TransactionService {
    /**
     * Check if user has a pending transaction
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} userId - Telegram user ID
     * @param {string} transactionType - Optional: 'topup' or 'product'
     * @returns {Promise<Object|null>} - Pending transaction or null
     */
    async getPendingTransaction(context, userId, transactionType = null) {
        const query = {
            user_id: userId,
            isSuccess: false,
            isCanceled: false
        };

        if (transactionType) {
            query.transaction_type = transactionType;
        }

        return await transactionRepository.findOne(context, query);
    }

    /**
     * Create a new transaction record
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {Object} transactionData - Transaction details
     * @returns {Promise<Object>} - Created transaction
     */
    async createTransaction(context, transactionData) {
        return await transactionRepository.create(context, transactionData);
    }

    /**
     * Cancel a transaction and restore stock if needed
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {Object} transaction - Transaction to cancel
     * @returns {Promise<void>}
     */
    async cancelTransaction(context, transaction) {
        // Use repository method that now handles payment_status and platform record
        await transactionRepository.cancelTransaction(context, transaction.transactionId);

        // Restore stock only for product transactions (backward compatible)
        if (transaction.transaction_type === 'product') {
            const transactionItemsHelper = require('../utils/transactionItemsHelper');
            await transactionItemsHelper.restoreStockCompat(context, transaction);
        }
    }

    /**
     * Mark transaction as successful
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} transactionId - Transaction ID to mark as successful
     * @param {Date|string|null} paidAt - Payment date (optional, for settlement tracking)
     * @returns {Promise<void>}
     */
    async markTransactionSuccess(context, transactionId, paidAt = null, useOwnCredentials = false) {
        await transactionRepository.markAsSuccess(context, transactionId, paidAt, useOwnCredentials);
    }

    /**
     * Update user balance for top-up
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} userId - Telegram user ID
     * @param {number} amount - Amount to add
     * @returns {Promise<number>} - New balance
     */
    async topUpBalance(context, userId, amount) {
        await botUserBalanceRepository.updateOne(
            context,
            { userId: userId },
            {
                $inc: {
                    balance: amount,
                    totalTopUp: amount
                }
            },
            { upsert: true }
        );

        const userBalance = await botUserBalanceRepository.findByUserId(context, userId);
        return userBalance?.balance || 0;
    }

    /**
     * Deduct user balance for purchase
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} userId - Telegram user ID
     * @param {number} amount - Amount to deduct
     * @returns {Promise<number>} - New balance
     */
    async deductBalance(context, userId, amount) {
        // Atomic balance guard: only deduct if balance >= amount
        // This prevents double-click from driving balance negative
        const result = await botUserBalanceRepository.updateOne(
            context,
            { userId: userId, balance: { $gte: amount } },
            {
                $inc: {
                    balance: -amount,
                    totalSpent: amount
                }
            }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Saldo tidak cukup');
        }

        const userBalance = await botUserBalanceRepository.findByUserId(context, userId);
        return userBalance?.balance || 0;
    }

    /**
     * Get user balance
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} userId - Telegram user ID
     * @returns {Promise<number>} - Current balance
     */
    async getUserBalance(context, userId) {
        const userBalance = await botUserBalanceRepository.findByUserId(context, userId);
        return userBalance?.balance || 0;
    }

    /**
     * Create a platform-level transaction record (ownerId=null, botId=null)
     * with optional transaction items.
     * Called after every reseller order and platform top-up in MULTI mode.
     * Uses direct model access to bypass DualScoped null-context restriction.
     * Non-blocking: errors are logged but don't fail the main transaction.
     *
     * @param {Object} sourceData - Transaction data (profit will be calculated from items if provided)
     * @param {Object} [options] - Additional options
     * @param {Array} [options.items] - Transaction items to create
     * @param {string} options.items[].codeVariant - Variant code
     * @param {number} options.items[].quantity - Quantity
     * @param {number} options.items[].unitPrice - Price per unit (cost price from platform perspective)
     * @param {Array} options.items[].stockItems - Stock snapshots with profit field
     * @param {Object} options.items[].productInfo - { productCode, productName, variantName }
     * @returns {Promise<Object|null>} - Created platform record or null
     */
    async createPlatformRecord(sourceData, options = {}) {
        if (modeService.isSingleMode()) return null;

        // Generate platform transaction ID using default settings (no context needed)
        const type = sourceData.transaction_type || 'product';
        const platformTransactionId = await generatePlatformTransactionId(type, null);

        try {
            // Calculate profit from stock items if items are provided
            let profit = sourceData.profit || 0;
            if (options.items) {
                profit = options.items.reduce((total, item) => {
                    if (!item.stockItems) return total;
                    return total + item.stockItems.reduce((sum, s) => sum + (s.profit || 0), 0);
                }, 0);
            }

            const record = await TransactionModel.create({
                ...sourceData,
                transactionId: platformTransactionId,
                profit: parseInt(profit) || 0,
                botId: null,
                ownerId: null,
                isSuccess: true,
                isDelivered: true,
                isCanceled: false,
                isReminded: false,
                platform_reference: sourceData.transactionId // Reference to owner transaction (reverse link)
            });

            // Create transaction items if provided
            if (options.items && record) {
                for (const item of options.items) {
                    await OrderTransactionItemModel.create({
                        order_transaction_id: record._id.toString(),
                        codeVariant: item.codeVariant,
                        quantity: item.quantity,
                        unit_price: item.unitPrice,
                        cost_price: item.unitPrice,
                        subtotal: item.quantity * item.unitPrice,
                        data: item.stockItems || [],
                        product_code: item.productInfo.productCode,
                        product_name: item.productInfo.productName,
                        variant_name: item.productInfo.variantName,
                        botId: null,
                        ownerId: null,
                    });
                }
            }

            return record;
        } catch (err) {
            console.error(`[TransactionService] Failed to create platform record ${platformTransactionId}:`, err.message, err.stack);
            return null;
        }
    }

    /**
     * Generate unique transaction ID
     * @param {string} type - 'product' or 'topup'
     * @param {Object} ctx - Telegraf context (optional, for multi-mode support)
     * @returns {Promise<string>} - Generated transaction ID
     */
    async generateTransactionId(type, ctx = null) {
        return await generateTransactionId(type, ctx);
    }

    /**
     * Mark an owner top-up transaction as successfully paid (atomic CAS).
     * Uses direct TransactionModel access because ownerId=null bypasses DualScoped.
     *
     * @param {string} transactionId - Transaction ID
     * @param {Date|null} paidAt - Payment date
     * @param {string|null} paymentId - Payment identifier (defaults to Date.now())
     * @param {Object} [options]
     * @param {boolean} [options.markDelivered=true] - Whether to set isDelivered=true
     * @returns {Promise<boolean>} true if updated, false if already processed
     */
    async markOwnerTopUpSuccess(transactionId, paidAt, paymentId, { markDelivered = true } = {}) {
        const updateFields = {
            isSuccess: true,
            payment_status: 'paid',
            payment_id: paymentId || Date.now().toString(),
        };
        if (markDelivered) updateFields.isDelivered = true;
        if (paidAt) updateFields.paid_at = paidAt;

        const result = await TransactionModel.updateOne(
            { transactionId, isSuccess: { $ne: true } },
            { $set: updateFields }
        );
        return result.modifiedCount > 0;
    }

    /**
     * Update platform reference on an existing transaction
     * Used to set platform_reference after platform record is created
     * @param {Object} context - Repository context
     * @param {string} transactionId - Owner transaction ID to update
     * @param {string} platformTransactionId - Platform transaction ID to set as reference
     * @returns {Promise<Object>} - Update result
     */
    async updatePlatformReference(context, transactionId, platformTransactionId) {
        return await transactionRepository.updateOne(
            context,
            { transactionId },
            { $set: { platform_reference: platformTransactionId } }
        );
    }
}

module.exports = new TransactionService();
