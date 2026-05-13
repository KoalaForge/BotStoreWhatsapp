const modeService = require('./modeService');
const userWhatsappBotModel = require('../database/models/userWhatsappBotModels');
const pricingService = require('./pricingService');

/**
 * Repository Context Service
 * Extracts botId and ownerId from Telegraf context for repository operations
 *
 * Responsibility:
 * - Extract botId from ctx.state.botId (set by botContextMiddleware in MULTI mode)
 * - Lookup ownerId from user_telegram_bots using botId
 * - Cache ownerId for performance (per-request cache)
 * - Handle SINGLE mode (returns null for both)
 */
class RepositoryContext {
    constructor() {
        // In-memory cache: { botId: ownerId }
        // Cleared automatically due to short-lived nature of Node.js context
        this._ownerIdCache = new Map();
    }

    /**
     * Extract repository context from Telegraf ctx
     * @param {Object} ctx - Telegraf context (optional for SINGLE mode)
     * @returns {Promise<Object>} - { botId, ownerId, mode }
     */
    async extractContext(ctx = null) {
        // SINGLE MODE: No isolation needed
        if (modeService.isSingleMode()) {
            return {
                botId: null,
                ownerId: null,
                mode: 'SINGLE'
            };
        }

        // MULTI MODE: Extract from ctx
        if (!ctx || !ctx.state || !ctx.state.botId) {
            throw new Error(
                '[RepositoryContext] MULTI mode requires ctx.state.botId. ' +
                'Ensure botContextMiddleware is registered.'
            );
        }

        const botId = ctx.state.botId;
        const ownerId = await this._getOwnerId(botId);

        return {
            botId,
            ownerId,
            mode: 'MULTI'
        };
    }

    /**
     * Get ownerId from botId with caching
     * @param {string} botId - MongoDB _id from user_telegram_bots
     * @returns {Promise<string>} - userId (ownerId)
     * @private
     */
    async _getOwnerId(botId) {
        // Check cache first
        if (this._ownerIdCache.has(botId)) {
            return this._ownerIdCache.get(botId);
        }

        // Lookup from database
        const bot = await userWhatsappBotModel.findById(botId).select('userId');

        if (!bot) {
            throw new Error(`[RepositoryContext] Bot not found: ${botId}`);
        }

        const ownerId = bot.userId;

        // Cache it
        this._ownerIdCache.set(botId, ownerId);

        return ownerId;
    }

    /**
     * Create context manually (for background jobs, API calls, etc.)
     * @param {string|null} botId - Bot ID (required in MULTI mode)
     * @param {string|null} ownerId - Owner ID (optional, will be looked up if not provided)
     * @returns {Promise<Object>} - { botId, ownerId, mode }
     */
    async createContext(botId = null, ownerId = null) {
        if (modeService.isSingleMode()) {
            return {
                botId: null,
                ownerId: null,
                mode: 'SINGLE'
            };
        }

        // MULTI mode
        if (!botId) {
            throw new Error('[RepositoryContext] botId is required in MULTI mode');
        }

        // If ownerId not provided, look it up
        if (!ownerId) {
            ownerId = await this._getOwnerId(botId);
        }

        return {
            botId,
            ownerId,
            mode: 'MULTI'
        };
    }

    /**
     * Clear cache (useful for testing or after bot deletion)
     * @param {string|null} botId - Specific botId to clear, or null to clear all
     */
    clearCache(botId = null) {
        if (botId) {
            this._ownerIdCache.delete(botId);
        } else {
            this._ownerIdCache.clear();
        }
    }

    /**
     * Get pricing service instance
     * @returns {Object} - pricingService singleton
     */
    getPricingService() {
        return pricingService;
    }
}

module.exports = new RepositoryContext();
