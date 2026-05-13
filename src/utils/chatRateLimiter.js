/**
 * Chat Rate Limiter
 * Prevents spam in chat sessions
 */

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS_PER_DAY = 3;

const MESSAGE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 10;

// In-memory trackers
const sessionTracker = new Map(); // userId -> [timestamps]
const messageTracker = new Map(); // userId -> { count, resetAt }

/**
 * Check if user can create a new session
 * @param {string} userId
 * @returns {{ allowed: boolean, remaining: number }}
 */
function canCreateSession(userId) {
    const key = String(userId);
    const now = Date.now();
    const timestamps = (sessionTracker.get(key) || []).filter(ts => now - ts < SESSION_WINDOW_MS);

    if (timestamps.length >= MAX_SESSIONS_PER_DAY) {
        return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: MAX_SESSIONS_PER_DAY - timestamps.length };
}

/**
 * Record a new session creation
 * @param {string} userId
 */
function recordSessionCreation(userId) {
    const key = String(userId);
    const timestamps = sessionTracker.get(key) || [];
    timestamps.push(Date.now());
    sessionTracker.set(key, timestamps);
}

/**
 * Check if user can send a message
 * @param {string} userId
 * @returns {{ allowed: boolean }}
 */
function canSendMessage(userId) {
    const key = String(userId);
    const now = Date.now();
    const limit = messageTracker.get(key) || { count: 0, resetAt: now + MESSAGE_WINDOW_MS };

    if (now > limit.resetAt) {
        limit.count = 0;
        limit.resetAt = now + MESSAGE_WINDOW_MS;
    }

    if (limit.count >= MAX_MESSAGES_PER_MINUTE) {
        return { allowed: false };
    }

    limit.count++;
    messageTracker.set(key, limit);
    return { allowed: true };
}

module.exports = {
    canCreateSession,
    recordSessionCreation,
    canSendMessage,
    MAX_SESSIONS_PER_DAY,
    MAX_MESSAGES_PER_MINUTE
};
