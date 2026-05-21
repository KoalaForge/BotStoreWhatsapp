const BaseRepository = require('./BaseRepository');
const GroupSettingsModel = require('../database/models/groupSettingsModel');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Group Settings Repository
 * Per-group feature toggles (compact list mode, etc.)
 *
 * Isolation Strategy: BotScoped
 * - Each bot has independent group settings
 * - Group identified by groupJid + botId (compound unique)
 */
class GroupSettingsRepository extends BaseRepository {
    constructor() {
        super(GroupSettingsModel, IsolationStrategy.BotScoped);
    }

    async findByGroup(ctx, groupJid) {
        return await this.findOne(ctx, { groupJid });
    }

    async setField(ctx, groupJid, field, value) {
        return await this.findOneAndUpdate(
            ctx,
            { groupJid },
            { $set: { [field]: value } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    async isCompactListEnabled(ctx, groupJid) {
        const doc = await this.findByGroup(ctx, groupJid);
        return doc?.compactListEnabled === true;
    }
}

module.exports = new GroupSettingsRepository();
