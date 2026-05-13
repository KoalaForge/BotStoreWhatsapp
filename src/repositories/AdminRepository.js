const BaseRepository = require('./BaseRepository');
const AdminModel = require('../database/models/adminModels');
const IsolationStrategy = require('./IsolationStrategy');
const { jidQuery } = require('../utils/jidHelper');

/**
 * Admin Repository
 * Handles admin CRUD with bot-level isolation
 *
 * Isolation Strategy: IsolationStrategy.BotScoped
 * - Admins are specific to each bot
 * - Filter by botId in MULTI mode
 * - No filtering in SINGLE mode
 */
class AdminRepository extends BaseRepository {
    constructor() {
        super(AdminModel, IsolationStrategy.BotScoped);
    }

    /**
     * Find admin by Telegram ID
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<Object|null>} - Admin document
     */
    async findByTelegramId(context, idTelegram) {
        return await this.findOne(context, { idTelegram: String(idTelegram) });
    }

    /**
     * Find admin by WhatsApp JID
     * @param {Object} context - Repository context
     * @param {string} idWhatsapp - WhatsApp JID
     * @returns {Promise<Object|null>} - Admin document
     */
    async findByWhatsappId(context, idWhatsapp) {
        return await this.findOne(context, jidQuery('idWhatsapp', idWhatsapp));
    }

    /**
     * Find all admins
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of admins
     */
    async findAllAdmins(context, options = {}) {
        const defaultOptions = { sort: { createdAt: 1 }, ...options };
        return await this.find(context, {}, defaultOptions);
    }

    /**
     * Add admin
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<Object>} - Created admin document
     */
    async addAdmin(context, idTelegram) {
        return await this.create(context, { idTelegram: String(idTelegram) });
    }

    /**
     * Remove admin
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<Object>} - Delete result
     */
    async removeAdmin(context, idTelegram) {
        return await this.deleteOne(context, { idTelegram: String(idTelegram) });
    }

    /**
     * Check if user is admin
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<boolean>} - True if user is admin
     */
    async isAdmin(context, idTelegram) {
        return await this.exists(context, { idTelegram: String(idTelegram) });
    }

    /**
     * Count total admins
     * @param {Object} context - Repository context
     * @returns {Promise<number>} - Admin count
     */
    async countAdmins(context) {
        return await this.count(context, {});
    }
}

module.exports = new AdminRepository();
