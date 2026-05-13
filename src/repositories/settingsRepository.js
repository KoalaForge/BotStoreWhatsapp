const settingModel = require('../database/models/settingModel');
const modeService = require('../services/modeService');

// In-memory TTL cache for settings — settings rarely change (admin-driven only).
// Key: botId (string) or '__single__' for single mode. Value: { data, ts }.
const _settingsCache = new Map();
const SETTINGS_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Settings Repository
 * Handles all database operations for settings with automatic fallback logic
 *
 * Fallback Strategy:
 * - Multi mode with botId: Try bot-specific settings, fall back to first record (default)
 * - Multi mode without botId: Use first record (default)
 * - Single mode: Use first record (global settings)
 */
class SettingsRepository {
    /**
     * Get settings with automatic fallback
     * @param {string|null} botId - Bot ID (optional)
     * @returns {Promise<Object|null>} Settings document or null
     */
    async findSettings(botId = null) {
        const cacheKey = modeService.isSingleMode() ? '__single__' : (botId || '__default__');
        const cached = _settingsCache.get(cacheKey);
        if (cached && (Date.now() - cached.ts) < SETTINGS_CACHE_TTL_MS) {
            return cached.data;
        }

        let settings;
        if (modeService.isSingleMode()) {
            // Single mode: always use first record (global settings)
            settings = await settingModel.findOne({});
        } else if (botId) {
            // Multi mode: try bot-specific, fallback to default
            settings = await settingModel.findOne({ botId });
            if (!settings) {
                settings = await settingModel.findOne({}).sort({ createdAt: 1 }).limit(1);
            }
        } else {
            // No botId in multi mode: use first record as default
            settings = await settingModel.findOne({}).sort({ createdAt: 1 }).limit(1);
        }

        _settingsCache.set(cacheKey, { data: settings, ts: Date.now() });
        return settings;
    }

    /**
     * Invalidate cached settings for a specific bot (or all in single mode).
     * Call this after updateSettings() so next read gets fresh data.
     * @param {string|null} botId
     */
    _invalidateCache(botId = null) {
        if (modeService.isSingleMode()) {
            _settingsCache.delete('__single__');
        } else {
            _settingsCache.delete(botId || '__default__');
        }
    }

    /**
     * Update settings with automatic mode detection
     * @param {string|null} botId - Bot ID (optional)
     * @param {Object} updates - Settings fields to update
     * @returns {Promise<Object>} Updated settings document
     */
    async updateSettings(botId = null, updates = {}) {
        const query = this._buildQuery(botId);

        const result = await settingModel.findOneAndUpdate(
            query,
            { $set: updates },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        this._invalidateCache(botId);
        return result;
    }

    /**
     * Create default settings for a new bot
     * @param {string} botId - Bot ID (required)
     * @returns {Promise<Object>} Created settings document
     */
    async createBotSettings(botId) {
        if (!botId) {
            throw new Error('[SettingsRepository] botId is required for creating bot settings');
        }

        // Check if settings already exist
        const existing = await settingModel.findOne({ botId });
        if (existing) {
            return existing;
        }

        // Get default settings (first record) to use as template
        const defaultSettings = await settingModel.findOne({}).sort({ createdAt: 1 }).limit(1);

        // Create new settings based on defaults
        const overlayEnabled = process.env.QRIS_OVERLAY_ENABLED === 'true';
        const settingsData = defaultSettings
            ? {
                botId,
                qrisTemplate: defaultSettings.qrisTemplate || process.env.QRIS_TEMPLATE_PATH,
                qrisDotColor: defaultSettings.qrisDotColor,
                qrisSize: defaultSettings.qrisSize,
                qrisX: defaultSettings.qrisX,
                qrisY: defaultSettings.qrisY,
                qrisBorderRadius: defaultSettings.qrisBorderRadius,
                sendNotification: defaultSettings.sendNotification,
                productsPerPage: defaultSettings.productsPerPage,
                productTransactionPrefix: defaultSettings.productTransactionPrefix,
                topupTransactionPrefix: defaultSettings.topupTransactionPrefix,
                qrisTemplateEnabled: overlayEnabled
            }
            : { botId, qrisTemplateEnabled: overlayEnabled }; // No defaults available, seed from env

        const newSettings = new settingModel(settingsData);
        return await newSettings.save();
    }

    /**
     * Initialize default settings (for first-time setup)
     * Creates the first record that serves as fallback/default
     * @returns {Promise<Object|null>} Created settings or null if already exists
     */
    async initializeDefaultSettings() {
        // Check if any settings exist
        const existing = await settingModel.findOne({});
        if (existing) {
            return null; // Defaults already exist
        }

        // Create first record with schema defaults
        const defaultSettings = new settingModel({});
        return await defaultSettings.save();
    }

    /**
     * Build query based on mode and botId
     * @param {string|null} botId - Bot ID
     * @returns {Object} MongoDB query object
     * @private
     */
    _buildQuery(botId) {
        if (modeService.isSingleMode()) {
            // Single mode: no botId in query
            return {};
        }

        // Multi mode: include botId if provided
        return botId ? { botId } : {};
    }

    /**
     * Check if default settings exist
     * @returns {Promise<boolean>}
     */
    async hasDefaultSettings() {
        const count = await settingModel.countDocuments({});
        return count > 0;
    }

    /**
     * Normalize csLinks array — converts old string entries to { link, label } objects.
     * @param {Array} csLinks - Raw csLinks from DB (may contain strings or objects)
     * @returns {Array<{link: string, label: string}>}
     */
    normalizeCSLinks(csLinks) {
        if (!Array.isArray(csLinks)) return [];
        return csLinks.map(item => {
            if (typeof item === 'string') {
                return { link: item, label: item };
            }
            return { link: item.link, label: item.label || item.link };
        });
    }

    async addCSLink(botId = null, link, label) {
        const query = this._buildQuery(botId);
        const current = await settingModel.findOne(query);
        const alreadyExists = current?.csLinks?.some(item => {
            const itemLink = typeof item === 'string' ? item : item.link;
            return itemLink === link;
        });
        if (alreadyExists) {
            return { added: false, settings: current };
        }
        const csEntry = { link, label };
        const result = await settingModel.findOneAndUpdate(
            query,
            { $push: { csLinks: csEntry } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        this._invalidateCache(botId);
        return { added: true, settings: result };
    }

    async removeCSLink(botId = null, link) {
        const query = this._buildQuery(botId);
        const current = await settingModel.findOne(query);
        const exists = current?.csLinks?.some(item => {
            const itemLink = typeof item === 'string' ? item : item.link;
            return itemLink === link;
        });
        if (!exists) {
            return { removed: false, settings: current };
        }
        // Pull both old string format and new object format
        await settingModel.findOneAndUpdate(
            query,
            { $pull: { csLinks: link } },
            { new: true }
        );
        const result = await settingModel.findOneAndUpdate(
            query,
            { $pull: { csLinks: { link: link } } },
            { new: true }
        );
        this._invalidateCache(botId);
        return { removed: true, settings: result };
    }
}

module.exports = new SettingsRepository();
