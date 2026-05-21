const groupSettingsRepository = require('../repositories/GroupSettingsRepository');

class GroupSettingsService {
    async getGroupSettings(ctx, groupJid) {
        return await groupSettingsRepository.findByGroup(ctx, groupJid);
    }

    async isCompactListEnabled(ctx, groupJid) {
        if (!groupJid) return false;
        return await groupSettingsRepository.isCompactListEnabled(ctx, groupJid);
    }

    async setCompactListEnabled(ctx, groupJid, enabled) {
        return await groupSettingsRepository.setField(ctx, groupJid, 'compactListEnabled', Boolean(enabled));
    }

    async isAutoSuggestEnabled(ctx, groupJid) {
        if (!groupJid) return true;
        const doc = await groupSettingsRepository.findByGroup(ctx, groupJid);
        return doc?.autoSuggestEnabled !== false;
    }

    async setAutoSuggestEnabled(ctx, groupJid, enabled) {
        return await groupSettingsRepository.setField(ctx, groupJid, 'autoSuggestEnabled', Boolean(enabled));
    }
}

module.exports = new GroupSettingsService();
