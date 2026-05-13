const userWhatsappBotModel = require('../database/models/userWhatsappBotModels');

/**
 * Mode Service - Helper for bot mode detection and management
 * Singleton service for SINGLE vs MULTI mode operations
 */
class ModeService {
    constructor() {
        this.mode = null;
        this._initializeMode();
    }

    /**
     * Initialize mode from environment
     * @private
     */
    _initializeMode() {
        const modeEnv = (process.env.BOT_MODE || 'SINGLE').toUpperCase();

        if (!['SINGLE', 'MULTI'].includes(modeEnv)) {
            throw new Error(`Invalid BOT_MODE: ${modeEnv}. Must be 'SINGLE' or 'MULTI'`);
        }

        this.mode = modeEnv;
    }

    /**
     * Check if running in SINGLE mode
     * @returns {boolean}
     */
    isSingleMode() {
        return this.mode === 'SINGLE';
    }

    /**
     * Check if running in MULTI mode
     * @returns {boolean}
     */
    isMultiMode() {
        return this.mode === 'MULTI';
    }

    /**
     * Get current mode
     * @returns {string} - 'SINGLE' or 'MULTI'
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get all active bot tokens (for MULTI mode)
     * @returns {Promise<Array>} - Array of bot documents
     */
    async getActiveBots() {
        if (this.isSingleMode()) {
            throw new Error('getActiveBots() is only available in MULTI mode');
        }

        const activeBots = await userWhatsappBotModel.find({
            isActive: true,
            isSuspended: false
        }).select('_id userId phoneNumber');

        return activeBots;
    }

    /**
     * Get bots by user ID (for MULTI mode)
     * @param {string} userId - User ID
     * @returns {Promise<Array>} - Array of bot documents
     */
    async getBotsByUserId(userId) {
        if (this.isSingleMode()) {
            throw new Error('getBotsByUserId() is only available in MULTI mode');
        }

        return await userWhatsappBotModel.find({
            userId: userId,
            isActive: true,
            isSuspended: false
        });
    }

    /**
     * Get bot by MongoDB _id (for MULTI mode)
     * @param {string} id - MongoDB _id
     * @returns {Promise<Object|null>} - Bot document or null
     */
    async getBotById(id) {
        if (this.isSingleMode()) {
            throw new Error('getBotById() is only available in MULTI mode');
        }

        return await userWhatsappBotModel.findById(id);
    }

    /**
     * Validate mode requirements
     * @throws {Error} if mode requirements are not met
     */
    validateModeRequirements() {
        if (this.isSingleMode()) {
            if (!process.env.WHITELIST_ID) {
                throw new Error('SINGLE mode requires WHITELIST_ID in environment');
            }
            if (!process.env.API_KEY) {
                throw new Error('SINGLE mode requires API_KEY for API authentication');
            }
            if (!process.env.WA_AUTH_ENCRYPTION_KEY) {
                throw new Error('SINGLE mode requires WA_AUTH_ENCRYPTION_KEY for encrypted session storage');
            }
            // WHATSAPP_PHONE_NUMBER is optional — pairing-code flow accepts
            // phone_number via POST /api/bots/create body; QR flow needs none.
        }

        if (this.isMultiMode()) {
            if (!process.env.WA_AUTH_ENCRYPTION_KEY) {
                throw new Error('MULTI mode requires WA_AUTH_ENCRYPTION_KEY in environment');
            }
            if (!process.env.API_KEY) {
                throw new Error('MULTI mode requires API_KEY for API authentication');
            }
        }
    }
}

module.exports = new ModeService();
