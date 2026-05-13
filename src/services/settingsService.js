const settingsRepository = require('../repositories/settingsRepository');

/**
 * Settings Service - Clean interface for settings access
 * Delegates all database operations to SettingsRepository
 * No mode-specific logic here - repository handles everything
 */
class SettingsService {
    /**
     * Get settings with automatic fallback
     * Repository handles: mode detection, botId extraction, fallback to defaults
     *
     * @param {Object|null} ctx - Telegraf context (optional)
     * @returns {Promise<Object|null>} Settings document or null
     */
    async getSettings(ctx = null) {
        const botId = this._extractBotId(ctx);
        return await settingsRepository.findSettings(botId);
    }

    /**
     * Update settings
     * @param {Object|null} ctx - Telegraf context (optional)
     * @param {Object} updates - Settings fields to update
     * @returns {Promise<Object>} Updated settings document
     */
    async updateSettings(ctx = null, updates = {}) {
        const botId = this._extractBotId(ctx);
        return await settingsRepository.updateSettings(botId, updates);
    }

    /**
     * Initialize settings for a new bot (multi-mode only)
     * @param {string} botId - MongoDB _id of the bot
     * @returns {Promise<Object>} Created or existing settings
     */
    async initializeSettings(botId) {
        if (!botId) {
            throw new Error('[SettingsService] botId is required for settings initialization');
        }

        return await settingsRepository.createBotSettings(botId);
    }

    /**
     * Get settings by botId directly (for background jobs without ctx)
     * @param {string} botId - MongoDB _id of the bot
     * @returns {Promise<Object|null>} Settings document or null
     */
    async getSettingsByBotId(botId) {
        return await settingsRepository.findSettings(botId);
    }

    /**
     * Initialize default settings (first-time setup)
     * Creates the first record that serves as fallback/template
     * @returns {Promise<Object|null>} Created settings or null if exists
     */
    async initializeDefaultSettings() {
        return await settingsRepository.initializeDefaultSettings();
    }

    async addCSLink(ctx = null, link, label) {
        const botId = this._extractBotId(ctx);
        return await settingsRepository.addCSLink(botId, link, label);
    }

    /**
     * Normalize csLinks from settings into consistent { link, label } objects.
     * Handles backward compat for old string entries.
     * @param {Array} csLinks - Raw csLinks from settings
     * @returns {Array<{link: string, label: string}>}
     */
    normalizeCSLinks(csLinks) {
        return settingsRepository.normalizeCSLinks(csLinks);
    }

    async removeCSLink(ctx = null, link) {
        const botId = this._extractBotId(ctx);
        return await settingsRepository.removeCSLink(botId, link);
    }

    /**
     * Extract botId from Telegraf context
     * @param {Object|null} ctx - Telegraf context
     * @returns {string|null} Bot ID or null
     * @private
     */
    _extractBotId(ctx) {
        return ctx?.state?.botId || null;
    }
}

module.exports = new SettingsService();
