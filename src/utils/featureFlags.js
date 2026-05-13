'use strict';

const settingsService = require('../services/settingsService');

/**
 * Check whether a feature is enabled for the current bot context.
 * Defaults to true if the setting is not yet present (backward compatible).
 *
 * @param {Object} ctx - Telegraf context
 * @param {'saldoEnabled'|'chatEnabled'} feature - Setting field name
 * @returns {Promise<boolean>}
 */
async function isFeatureEnabled(ctx, feature) {
    try {
        const settings = await settingsService.getSettings(ctx);
        const val = settings?.[feature];
        // undefined (field not yet set) → treat as enabled
        return val !== false;
    } catch {
        // Fail-open: if settings can't be read, don't block users
        return true;
    }
}

module.exports = { isFeatureEnabled };
