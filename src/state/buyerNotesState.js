/**
 * Buyer Notes State Management
 * In-memory state (primary) with optional Redis layer (fast persistence)
 * or MongoDB persistence (backup for restarts when Redis is not configured).
 *
 * State Structure: {
 *   userId: {
 *     notes,                // current notes text (null if not set)
 *     awaitingNotesInput,   // true when waiting for user to type notes
 *     orderMessageChatId,   // chat ID of order screen (for keyboard update after input)
 *     orderMessageId,       // message ID of order screen (for keyboard update after input)
 *     promptMessageId,      // message ID of input prompt (for deletion after input)
 *     variantValue,         // variant code (for keyboard rebuild)
 *     productCode,          // product code (for keyboard back button)
 *     timestamp
 *   }
 * }
 */

const appStateModel = require('../database/models/appStateModel');
const { getRedisClient } = require('../utils/redisClient');

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const REDIS_PREFIX = 'buyer_notes';

const userNotesState = new Map();

// Periodic cleanup — prevents unbounded Map growth under long uptime
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of userNotesState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            userNotesState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

/**
 * Get buyer notes state for a user
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Object|null>} - User's notes state or null
 */
async function getUserNotesState(userId) {
    const memState = userNotesState.get(userId);
    if (memState) {
        const isExpired = memState.timestamp && Date.now() - memState.timestamp > EXPIRY_MS;
        if (!isExpired) return memState;
        userNotesState.delete(userId);
    }

    const redis = await getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(`${REDIS_PREFIX}:${userId}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                userNotesState.set(userId, parsed);
                return parsed;
            }
            return null;
        } catch (err) {
            console.error('Failed to read buyer notes state from Redis:', err.message);
        }
    }

    try {
        const key = `buyer_notes:${userId}`;
        const doc = await appStateModel.findOne({
            key,
            expires_at: { $gt: new Date() }
        }).lean();

        if (doc) {
            userNotesState.set(userId, doc.data);
            return doc.data;
        }
    } catch (err) {
        console.error('Failed to read buyer notes state from DB:', err.message);
    }

    return null;
}

/**
 * Set complete buyer notes state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} state - Complete state object
 */
async function setUserNotesState(userId, state) {
    state.timestamp = Date.now();
    userNotesState.set(userId, state);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.setEx(`${REDIS_PREFIX}:${userId}`, Math.ceil(EXPIRY_MS / 1000), JSON.stringify(state));
            return;
        } catch (err) {
            console.error('Failed to write buyer notes state to Redis:', err.message);
        }
    }

    try {
        const key = `buyer_notes:${userId}`;
        await appStateModel.findOneAndUpdate(
            { key },
            {
                key,
                state_type: 'buyer_notes',
                user_id: userId,
                data: state,
                expires_at: new Date(Date.now() + EXPIRY_MS)
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Failed to persist buyer notes state:', err.message);
        // In-memory still works as fallback
    }
}

/**
 * Update partial buyer notes state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} updates - Partial state updates
 */
async function updateUserNotesState(userId, updates) {
    const existingState = await getUserNotesState(userId) || {};
    const newState = { ...existingState, ...updates };
    await setUserNotesState(userId, newState);
}

/**
 * Clear buyer notes state for a user
 * @param {number} userId - Telegram user ID
 */
async function clearBuyerNotes(userId) {
    userNotesState.delete(userId);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.del(`${REDIS_PREFIX}:${userId}`);
            return;
        } catch (err) {
            console.error('Failed to delete buyer notes state from Redis:', err.message);
        }
    }

    try {
        const key = `buyer_notes:${userId}`;
        await appStateModel.deleteOne({ key });
    } catch (err) {
        console.error('Failed to clear buyer notes state from DB:', err.message);
    }
}

/**
 * Get applied notes text for a user (only if not in awaiting-input mode)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<string|null>} - Notes text or null
 */
async function getAppliedNotes(userId) {
    const state = await getUserNotesState(userId);
    if (!state || !state.notes || state.awaitingNotesInput) return null;
    return state.notes;
}

/**
 * Check if user is currently waiting for notes input
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>} - True if awaiting notes input
 */
async function isAwaitingNotes(userId) {
    const state = await getUserNotesState(userId);
    return !!(state && state.awaitingNotesInput === true);
}

module.exports = {
    getUserNotesState,
    setUserNotesState,
    updateUserNotesState,
    clearBuyerNotes,
    getAppliedNotes,
    isAwaitingNotes
};
