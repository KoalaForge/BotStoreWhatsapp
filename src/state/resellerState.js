/**
 * Reseller State Management
 * In-memory state (primary) with optional Redis layer (fast persistence)
 * or MongoDB persistence (backup for restarts when Redis is not configured).
 *
 * State Structure per userId:
 * {
 *   platformVariantCode,  // platform variant codeVariant
 *   resellerProductCode,  // reseller product code
 *   configId,             // reseller_variant_config._id
 *   markup_type,          // 'fixed' | 'percentage'
 *   markup_value,         // number
 *   displayName,          // custom_name || platformVariant.name
 *   markupPerUnit,        // number
 *   timestamp             // auto-expire after 10 min
 * }
 */

const appStateModel = require('../database/models/appStateModel');
const { getRedisClient } = require('../utils/redisClient');

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const REDIS_PREFIX = 'reseller_order';

const resellerOrderState = new Map();

// Periodic cleanup — prevents unbounded Map growth under long uptime
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of resellerOrderState.entries()) {
        if (now - (state.timestamp || 0) > EXPIRY_MS) {
            resellerOrderState.delete(key);
        }
    }
}, EXPIRY_MS).unref();

/**
 * Set reseller order state for a user
 * @param {number} userId - Telegram user ID
 * @param {Object} data - Reseller order data
 */
async function setResellerOrder(userId, data) {
    const stateData = { ...data, timestamp: Date.now() };

    resellerOrderState.set(userId, stateData);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.setEx(`${REDIS_PREFIX}:${userId}`, Math.ceil(EXPIRY_MS / 1000), JSON.stringify(stateData));
            return; // Skip MongoDB write when Redis is available
        } catch (err) {
            console.error('Failed to persist reseller state to Redis:', err.message);
            // fall through to MongoDB
        }
    }

    try {
        const key = `reseller_order:${userId}`;
        await appStateModel.findOneAndUpdate(
            { key },
            {
                key,
                state_type: 'reseller_order',
                user_id: userId,
                data: stateData,
                expires_at: new Date(Date.now() + EXPIRY_MS)
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Failed to persist reseller state:', err.message);
        // In-memory still works as fallback
    }
}

/**
 * Get reseller order state for a user (returns null if expired)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Object|null>} - Reseller order data or null
 */
async function getResellerOrder(userId) {
    // Try in-memory first (fast path)
    const memState = resellerOrderState.get(userId);
    if (memState) {
        if (Date.now() - memState.timestamp > EXPIRY_MS) {
            resellerOrderState.delete(userId);
            return null;
        }
        return memState;
    }

    // Try Redis (if configured)
    const redis = await getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(`${REDIS_PREFIX}:${userId}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                resellerOrderState.set(userId, parsed);
                return parsed;
            }
            return null;
        } catch (err) {
            console.error('Failed to read reseller state from Redis:', err.message);
            // fall through to MongoDB
        }
    }

    // Fallback to MongoDB (after restart, or if Redis not configured / failed)
    try {
        const key = `reseller_order:${userId}`;
        const doc = await appStateModel.findOne({
            key,
            expires_at: { $gt: new Date() }
        }).lean();

        if (doc) {
            resellerOrderState.set(userId, doc.data);
            return doc.data;
        }
    } catch (err) {
        console.error('Failed to read reseller state from DB:', err.message);
    }

    return null;
}

/**
 * Clear reseller order state for a user
 * @param {number} userId - Telegram user ID
 */
async function clearResellerOrder(userId) {
    resellerOrderState.delete(userId);

    const redis = await getRedisClient();
    if (redis) {
        try {
            await redis.del(`${REDIS_PREFIX}:${userId}`);
            return;
        } catch (err) {
            console.error('Failed to delete reseller state from Redis:', err.message);
            // fall through to MongoDB
        }
    }

    try {
        const key = `reseller_order:${userId}`;
        await appStateModel.deleteOne({ key });
    } catch (err) {
        console.error('Failed to clear reseller state from DB:', err.message);
    }
}

/**
 * Check if user has an active reseller order
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>}
 */
async function isResellerOrder(userId) {
    const order = await getResellerOrder(userId);
    return order !== null;
}

module.exports = {
    setResellerOrder,
    getResellerOrder,
    clearResellerOrder,
    isResellerOrder
};
