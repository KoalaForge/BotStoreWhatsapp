/**
 * Voucher State Management
 * In-memory state (primary) with optional Redis layer (fast persistence)
 * or MongoDB persistence (backup for restarts when Redis is not configured).
 *
 * State Structure: {
 *   userId: {
 *     voucherCode,
 *     discountAmount,
 *     discountType,
 *     discountValue,
 *     maxDiscountAmount,
 *     variantCode,
 *     messageId,
 *     chatId,
 *     orderAmount,
 *     messageText,
 *     awaitingVoucherCode,
 *     promptMessageId
 *   }
 * }
 */

const appStateModel = require('../database/models/appStateModel');
const { getRedisClient } = require('../utils/redisClient');

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const REDIS_PREFIX = 'voucher';

// In-memory storage for voucher application state per user
const userVoucherState = new Map();

// Periodic cleanup — prevents unbounded Map growth under long uptime
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of userVoucherState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            userVoucherState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

/**
 * Get voucher state for a user
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Object|null>} - User's voucher state or null
 */
async function getUserVoucherState(userId) {
    // Try in-memory first (fast path)
    const memState = userVoucherState.get(userId);
    if (memState) {
        const isExpired = memState.timestamp && Date.now() - memState.timestamp > EXPIRY_MS;
        if (!isExpired) return memState;
        userVoucherState.delete(userId);
    }

    // Try Redis (if configured)
    const redis = await getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(`${REDIS_PREFIX}:${userId}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                userVoucherState.set(userId, parsed);
                return parsed;
            }
            return null;
        } catch (err) {
            console.error('Failed to read voucher state from Redis:', err.message);
            // fall through to MongoDB
        }
    }

    // Fallback to MongoDB (after restart, or if Redis not configured / failed)
    try {
        const key = `voucher:${userId}`;
        const doc = await appStateModel.findOne({
            key,
            expires_at: { $gt: new Date() }
        }).lean();

        if (doc) {
            userVoucherState.set(userId, doc.data);
            return doc.data;
        }
    } catch (err) {
        console.error('Failed to read voucher state from DB:', err.message);
    }

    return null;
}

/**
 * Set complete voucher state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} state - Complete state object
 */
async function setUserVoucherState(userId, state) {
    state.timestamp = Date.now();
    userVoucherState.set(userId, state);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.setEx(`${REDIS_PREFIX}:${userId}`, Math.ceil(EXPIRY_MS / 1000), JSON.stringify(state));
            return; // Skip MongoDB write when Redis is available
        } catch (err) {
            console.error('Failed to write voucher state to Redis:', err.message);
            // fall through to MongoDB
        }
    }

    try {
        const key = `voucher:${userId}`;
        await appStateModel.findOneAndUpdate(
            { key },
            {
                key,
                state_type: 'voucher',
                user_id: userId,
                data: state,
                expires_at: new Date(Date.now() + EXPIRY_MS)
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Failed to persist voucher state:', err.message);
        // In-memory still works as fallback
    }
}

/**
 * Update partial voucher state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} updates - Partial state updates
 */
async function updateUserVoucherState(userId, updates) {
    const existingState = await getUserVoucherState(userId) || {};
    const newState = { ...existingState, ...updates };

    userVoucherState.set(userId, newState);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.setEx(`${REDIS_PREFIX}:${userId}`, Math.ceil(EXPIRY_MS / 1000), JSON.stringify(newState));
            return;
        } catch (err) {
            console.error('Failed to update voucher state in Redis:', err.message);
            // fall through to MongoDB
        }
    }

    try {
        const key = `voucher:${userId}`;
        await appStateModel.findOneAndUpdate(
            { key },
            {
                key,
                state_type: 'voucher',
                user_id: userId,
                data: newState,
                expires_at: new Date(Date.now() + EXPIRY_MS)
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Failed to persist voucher state update:', err.message);
        // In-memory still works as fallback
    }
}

/**
 * Clear voucher state for a user
 * @param {number} userId - Telegram user ID
 */
async function clearUserVoucherState(userId) {
    userVoucherState.delete(userId);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.del(`${REDIS_PREFIX}:${userId}`);
            return;
        } catch (err) {
            console.error('Failed to delete voucher state from Redis:', err.message);
            // fall through to MongoDB
        }
    }

    try {
        const key = `voucher:${userId}`;
        await appStateModel.deleteOne({ key });
    } catch (err) {
        console.error('Failed to clear voucher state from DB:', err.message);
    }
}

/**
 * Check if user is currently waiting for voucher code input
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>} - True if awaiting voucher code
 */
async function isAwaitingVoucherCode(userId) {
    const state = await getUserVoucherState(userId);
    return state && state.awaitingVoucherCode === true;
}

/**
 * Get applied voucher info for a user (code and discount only)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Object>} - { voucherCode, discountAmount } or { voucherCode: null, discountAmount: 0 }
 */
async function getAppliedVoucher(userId) {
    const state = await getUserVoucherState(userId);

    if (state && state.voucherCode) {
        return {
            voucherCode: state.voucherCode,
            discountAmount: state.discountAmount || 0
        };
    }

    return {
        voucherCode: null,
        discountAmount: 0
    };
}

module.exports = {
    getUserVoucherState,
    setUserVoucherState,
    updateUserVoucherState,
    clearUserVoucherState,
    isAwaitingVoucherCode,
    getAppliedVoucher
};
