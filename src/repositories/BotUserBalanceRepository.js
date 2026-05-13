const BaseRepository = require('./BaseRepository');
const BotUserBalanceModel = require('../database/models/botUserBalanceModels');
const IsolationStrategy = require('./IsolationStrategy');
const { jidQuery } = require('../utils/jidHelper');

/**
 * Bot User Balance Repository
 * Handles user balance CRUD with bot-level isolation
 *
 * Isolation Strategy: IsolationStrategy.BotScoped
 * - Balances are specific to each bot (same user can have different balance per bot)
 * - Filter by botId in MULTI mode
 * - No filtering in SINGLE mode
 */
class BotUserBalanceRepository extends BaseRepository {
    constructor() {
        super(BotUserBalanceModel, IsolationStrategy.BotScoped);
    }

    /**
     * Find balance by user ID
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @returns {Promise<Object|null>} - Balance document
     */
    async findByUserId(context, userId) {
        return await this.findOne(context, jidQuery('userId', userId));
    }

    /**
     * Create balance for user (if not exists)
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @param {number} initialBalance - Initial balance (default: 0)
     * @returns {Promise<Object>} - Created balance document
     */
    async createBalance(context, userId, initialBalance = 0) {
        return await this.create(context, {
            userId,
            balance: initialBalance,
            totalTopUp: initialBalance,
            totalSpent: 0
        });
    }

    /**
     * Get or create balance (upsert pattern)
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @returns {Promise<Object>} - Balance document
     */
    async getOrCreateBalance(context, userId) {
        let balance = await this.findByUserId(context, userId);

        if (!balance) {
            balance = await this.createBalance(context, userId, 0);
        }

        return balance;
    }

    /**
     * Add balance (top up)
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @param {number} amount - Amount to add
     * @returns {Promise<Object>} - Update result
     */
    async addBalance(context, userId, amount) {
        // Ensure balance exists first
        await this.getOrCreateBalance(context, userId);

        return await this.updateOne(
            context,
            jidQuery('userId', userId),
            {
                $inc: {
                    balance: amount,
                    totalTopUp: amount
                }
            }
        );
    }

    /**
     * Deduct balance (spend)
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @param {number} amount - Amount to deduct
     * @returns {Promise<Object>} - Update result
     * @throws {Error} If insufficient balance
     */
    async deductBalance(context, userId, amount) {
        const balance = await this.findByUserId(context, userId);

        if (!balance || balance.balance < amount) {
            throw new Error('Insufficient balance');
        }

        return await this.updateOne(
            context,
            jidQuery('userId', userId),
            {
                $inc: {
                    balance: -amount,
                    totalSpent: amount
                }
            }
        );
    }

    /**
     * Check if user has sufficient balance
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @param {number} requiredAmount - Required amount
     * @returns {Promise<boolean>} - True if sufficient balance
     */
    async hasSufficientBalance(context, userId, requiredAmount) {
        const balance = await this.findByUserId(context, userId);
        return balance ? balance.balance >= requiredAmount : false;
    }

    /**
     * Get user's current balance amount
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @returns {Promise<number>} - Current balance
     */
    async getBalanceAmount(context, userId) {
        const balance = await this.findByUserId(context, userId);
        return balance ? balance.balance : 0;
    }

    /**
     * Set balance directly (admin operation)
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @param {number} newBalance - New balance amount
     * @returns {Promise<Object>} - Update result
     */
    async setBalance(context, userId, newBalance) {
        // Ensure balance exists first
        await this.getOrCreateBalance(context, userId);

        return await this.updateOne(
            context,
            jidQuery('userId', userId),
            { $set: { balance: newBalance } }
        );
    }

    /**
     * Get top users by balance
     * @param {Object} context - Repository context
     * @param {number} limit - Number of top users (default: 10)
     * @returns {Promise<Array>} - Array of top balance users
     */
    async getTopBalances(context, limit = 10) {
        return await this.find(
            context,
            {},
            { sort: { balance: -1 }, limit }
        );
    }

    /**
     * Get total balances statistics
     * @param {Object} context - Repository context
     * @returns {Promise<Object>} - Statistics
     */
    async getBalanceStats(context) {
        const result = await this.aggregate(context, [
            {
                $group: {
                    _id: null,
                    totalBalance: { $sum: '$balance' },
                    totalTopUp: { $sum: '$totalTopUp' },
                    totalSpent: { $sum: '$totalSpent' },
                    userCount: { $sum: 1 }
                }
            }
        ]);

        if (result.length > 0) {
            return result[0];
        }

        return {
            totalBalance: 0,
            totalTopUp: 0,
            totalSpent: 0,
            userCount: 0
        };
    }

    /**
     * Count users with balance > 0
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Count
     */
    async countUsersWithBalance(context) {
        return await this.count(context, { balance: { $gt: 0 } });
    }

    /**
     * Delete balance
     * @param {Object} context - Repository context
     * @param {number} userId - Telegram user ID
     * @returns {Promise<Object>} - Delete result
     */
    async deleteBalance(context, userId) {
        return await this.deleteOne(context, jidQuery('userId', userId));
    }
}

module.exports = new BotUserBalanceRepository();
