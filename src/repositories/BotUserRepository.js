const BaseRepository = require('./BaseRepository');
const BotUserModel = require('../database/models/botUserModels');
const IsolationStrategy = require('./IsolationStrategy');
const { jidQuery } = require('../utils/jidHelper');

/**
 * Bot User Repository
 * Handles bot user CRUD with bot-level isolation
 *
 * Isolation Strategy: IsolationStrategy.BotScoped
 * - Bot users are specific to each bot
 * - Filter by botId in MULTI mode
 * - No filtering in SINGLE mode
 */
class BotUserRepository extends BaseRepository {
    constructor() {
        super(BotUserModel, IsolationStrategy.BotScoped);
    }

    /**
     * Find user by Telegram ID
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<Object|null>} - User document
     */
    async findByTelegramId(context, idTelegram) {
        return await this.findOne(context, { idTelegram });
    }

    /**
     * Find user by WhatsApp JID
     * @param {Object} context - Repository context
     * @param {string} idWhatsapp - WhatsApp JID (e.g. "6281234567890@s.whatsapp.net")
     * @returns {Promise<Object|null>} - User document
     */
    async findByWhatsappId(context, idWhatsapp) {
        return await this.findOne(context, jidQuery('idWhatsapp', idWhatsapp));
    }

    /**
     * Find all users
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of users
     */
    async findAllUsers(context, options = {}) {
        const defaultOptions = { sort: { createdAt: 1 }, ...options };
        return await this.find(context, {}, defaultOptions);
    }

    /**
     * Find non-banned users (for broadcasting)
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of non-banned users
     */
    async findActiveUsers(context, options = {}) {
        const defaultOptions = { sort: { createdAt: 1 }, ...options };
        return await this.find(context, { is_banned: { $ne: true } }, defaultOptions);
    }

    /**
     * Find banned users
     * @param {Object} context - Repository context
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of banned users
     */
    async findBannedUsers(context, options = {}) {
        const defaultOptions = { sort: { banned_at: -1 }, ...options };
        return await this.find(context, { is_banned: true }, defaultOptions);
    }

    /**
     * Add or update user (upsert)
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @param {string} usernameTelegram - Telegram username
     * @returns {Promise<Object>} - Created/updated user document
     */
    async upsertUser(context, idTelegram, usernameTelegram = null) {
        const existing = await this.findByTelegramId(context, idTelegram);

        if (existing) {
            // Update username if provided
            if (usernameTelegram) {
                await this.updateOne(
                    context,
                    { idTelegram },
                    { $set: { usernameTelegram } }
                );
            }
            return existing;
        }

        // Create new user
        return await this.create(context, {
            idTelegram,
            usernameTelegram,
            is_banned: false
        });
    }

    /**
     * Add or update WhatsApp user (upsert)
     * @param {Object} context - Repository context
     * @param {string} idWhatsapp - WhatsApp JID
     * @param {string} pushName - WhatsApp push name (display name)
     * @returns {Promise<Object>} - Created/updated user document
     */
    async upsertWhatsappUser(context, idWhatsapp, pushName = null) {
        const existing = await this.findByWhatsappId(context, idWhatsapp);

        if (existing) {
            if (pushName && pushName !== existing.usernameTelegram) {
                await this.updateOne(
                    context,
                    { idWhatsapp: existing.idWhatsapp },
                    { $set: { usernameTelegram: pushName } }
                );
            }
            return existing;
        }

        return await this.create(context, {
            idWhatsapp,
            usernameTelegram: pushName,
            is_banned: false
        });
    }

    /**
     * Ban user
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID to ban
     * @param {string} banReason - Reason for ban
     * @param {number} bannedBy - Admin ID who banned the user
     * @returns {Promise<Object>} - Update result
     */
    async banUser(context, idTelegram, banReason, bannedBy) {
        return await this.updateOne(
            context,
            { idTelegram },
            {
                $set: {
                    is_banned: true,
                    ban_reason: banReason,
                    banned_at: new Date(),
                    banned_by: bannedBy
                }
            }
        );
    }

    /**
     * Unban user
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID to unban
     * @returns {Promise<Object>} - Update result
     */
    async unbanUser(context, idTelegram) {
        return await this.updateOne(
            context,
            { idTelegram },
            {
                $set: {
                    is_banned: false,
                    ban_reason: null,
                    banned_at: null,
                    banned_by: null
                }
            }
        );
    }

    /**
     * Check if user is banned
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<boolean>} - True if banned
     */
    async isBanned(context, idTelegram) {
        const user = await this.findByTelegramId(context, idTelegram);
        return user ? user.is_banned : false;
    }

    /**
     * Count total users
     * @param {Object} context - Repository context
     * @param {boolean} excludeBanned - Exclude banned users from count
     * @returns {Promise<number>} - User count
     */
    async countUsers(context, excludeBanned = false) {
        const filter = excludeBanned ? { is_banned: { $ne: true } } : {};
        return await this.count(context, filter);
    }

    /**
     * Delete user
     * @param {Object} context - Repository context
     * @param {number} idTelegram - Telegram user ID
     * @returns {Promise<Object>} - Delete result
     */
    async deleteUser(context, idTelegram) {
        return await this.deleteOne(context, { idTelegram });
    }

    // ============================================
    // WHITELIST MODE METHODS (WhatsApp variant)
    // ============================================

    /**
     * Set or clear an auto spam-block on a WhatsApp user.
     * Passing `untilDate=null` clears the block.
     * @param {Object} context
     * @param {string} idWhatsapp - phone-only or full JID (jidQuery normalises)
     * @param {Date|null} untilDate
     * @param {string|null} reason
     */
    async setSpamBlock(context, idWhatsapp, untilDate, reason = null) {
        return await this.updateOne(
            context,
            jidQuery('idWhatsapp', idWhatsapp),
            {
                $set: {
                    spam_blocked_until: untilDate,
                    spam_block_reason: untilDate ? reason : null
                }
            }
        );
    }

    /**
     * Find users by whitelist_status with pagination.
     * Excludes banned users.
     * @param {Object} context
     * @param {string} status - 'pending'|'approved'|'rejected'
     * @param {Object} opts - { page, limit, excludePhones }
     * @returns {Promise<{ users, total, page, limit }>}
     */
    async findByWhitelistStatus(context, status, { page = 1, limit = 10, excludePhones = [] } = {}) {
        const filter = { whitelist_status: status, is_banned: { $ne: true }, idWhatsapp: { $ne: null } };
        if (excludePhones.length) {
            const variants = [];
            for (const p of excludePhones) {
                variants.push(p);
                variants.push(p + '@s.whatsapp.net');
            }
            filter.idWhatsapp = { $nin: variants, $ne: null };
        }
        const sort = status === 'pending' ? { whitelist_requested_at: 1 } : { whitelist_actioned_at: -1 };
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
        const skip = (safePage - 1) * safeLimit;

        const [users, total] = await Promise.all([
            this.find(context, filter, { sort, skip, limit: safeLimit }),
            this.count(context, filter)
        ]);
        return { users, total, page: safePage, limit: safeLimit };
    }

    /**
     * Atomic conditional update of whitelist_status by WhatsApp identifier.
     * Filter `whitelist_status: { $ne: status }` makes update idempotent under
     * concurrent admin clicks.
     * @param {Object} context
     * @param {string} idWhatsapp - phone-only OR full JID (jidQuery normalises)
     * @param {string} newStatus
     * @param {string|null} adminIdentifier - phone/jid/_id (Mixed)
     */
    async setWhitelistStatus(context, idWhatsapp, newStatus, adminIdentifier = null) {
        const filter = {
            ...jidQuery('idWhatsapp', idWhatsapp),
            whitelist_status: { $ne: newStatus }
        };
        return await this.updateOne(context, filter, {
            $set: {
                whitelist_status: newStatus,
                whitelist_actioned_at: new Date(),
                whitelist_actioned_by: adminIdentifier
            }
        });
    }

    /**
     * Mark a WA user as pending and bump request count atomically.
     * Upserts if user record missing.
     * @param {Object} context
     * @param {string} idWhatsapp - normalized phone or full JID
     * @param {string|null} pushName
     * @returns {Promise<Object|null>} updated/created user document
     */
    async markPendingWhatsapp(context, idWhatsapp, pushName = null) {
        const now = new Date();
        // First try to find an existing record (handles either stored format via jidQuery)
        const existing = await this.findByWhatsappId(context, idWhatsapp);
        const update = {
            $set: {
                whitelist_status: 'pending',
                whitelist_requested_at: now,
                whitelist_actioned_at: null,
                whitelist_actioned_by: null
            },
            $inc: { whitelist_request_count: 1 }
        };
        if (existing) {
            await this.updateOne(context, { _id: existing._id }, update);
            if (pushName && pushName !== existing.usernameTelegram) {
                await this.updateOne(context, { _id: existing._id }, { $set: { usernameTelegram: pushName } });
            }
            return await this.findOne(context, { _id: existing._id });
        }
        return await this.create(context, {
            idWhatsapp,
            usernameTelegram: pushName,
            is_banned: false,
            whitelist_status: 'pending',
            whitelist_requested_at: now,
            whitelist_request_count: 1
        });
    }

    /**
     * Bulk reset all non-banned WhatsApp users in this scope to pending,
     * excluding any phone numbers provided (typically admin phones).
     * Restricted to records with idWhatsapp set so cross-platform Telegram
     * records stay untouched.
     * @param {Object} context
     * @param {Array<string>} excludePhones
     * @returns {Promise<number>} modifiedCount
     */
    async bulkResetWhatsappToPending(context, excludePhones = []) {
        const now = new Date();
        const filter = {
            is_banned: { $ne: true },
            idWhatsapp: { $ne: null }
        };
        if (excludePhones.length) {
            const variants = [];
            for (const p of excludePhones) {
                variants.push(p);
                variants.push(p + '@s.whatsapp.net');
            }
            filter.idWhatsapp = { $nin: variants, $ne: null };
        }
        const result = await this.updateMany(context, filter, {
            $set: {
                whitelist_status: 'pending',
                whitelist_requested_at: now,
                whitelist_actioned_at: null,
                whitelist_actioned_by: null
            }
        });
        return result?.modifiedCount ?? 0;
    }

    /**
     * Force-mark admin WhatsApp records as 'approved'. Idempotent.
     * Self-heal pattern: ensures admin never lingers in pending list.
     * @param {Object} context
     * @param {Array<string>} phones
     * @returns {Promise<number>} modifiedCount
     */
    async bulkApproveWhatsappPhones(context, phones = []) {
        if (!phones.length) return 0;
        const variants = [];
        for (const p of phones) {
            variants.push(p);
            variants.push(p + '@s.whatsapp.net');
        }
        const result = await this.updateMany(
            context,
            { idWhatsapp: { $in: variants }, whitelist_status: { $ne: 'approved' } },
            {
                $set: {
                    whitelist_status: 'approved',
                    whitelist_actioned_at: new Date(),
                    whitelist_actioned_by: null
                }
            }
        );
        return result?.modifiedCount ?? 0;
    }
}

module.exports = new BotUserRepository();
