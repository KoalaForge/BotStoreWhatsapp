'use strict';

/**
 * Outgoing Rate Limiter
 *
 * Throttles outgoing messages to avoid WhatsApp's anti-spam detection.
 * Tracks per-chat and global (per-bot) send rates.
 *
 * Limits:
 *  - Per chat : max  5 messages / 60 s
 *  - Global   : max 30 messages / 60 s
 *  - Daily    : max 1000 messages / 24 h
 *
 * Usage:
 *   const { canSendOutgoing, recordOutgoing } = require('./outgoingRateLimiter');
 *   if (!canSendOutgoing(chatJid).allowed) { /* throttle or queue * / }
 *   recordOutgoing(chatJid);
 */

const PER_CHAT_MAX   = 5;
const PER_CHAT_WIN   = 60_000;          // 60 seconds

const GLOBAL_MAX     = 30;
const GLOBAL_WIN     = 60_000;

const DAILY_MAX      = 1000;
const DAILY_WIN      = 24 * 3600_000;

// ── trackers ────────────────────────────────────────────────────────────────

/** @type {Map<string, number[]>} chatJid -> [timestamps] */
const chatTracker = new Map();

/** @type {number[]} global timestamps */
let globalTimestamps = [];

/** @type {number[]} daily timestamps */
let dailyTimestamps = [];

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Check whether we can send another outgoing message to `chatJid`.
 *
 * @param {string} chatJid
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canSendOutgoing(chatJid) {
    const now = Date.now();

    // Daily global cap
    dailyTimestamps = dailyTimestamps.filter(ts => now - ts < DAILY_WIN);
    if (dailyTimestamps.length >= DAILY_MAX) {
        return { allowed: false, reason: 'daily_limit' };
    }

    // Per-minute global cap
    globalTimestamps = globalTimestamps.filter(ts => now - ts < GLOBAL_WIN);
    if (globalTimestamps.length >= GLOBAL_MAX) {
        return { allowed: false, reason: 'global_minute_limit' };
    }

    // Per-chat cap
    const key = String(chatJid);
    const chatTs = (chatTracker.get(key) || []).filter(ts => now - ts < PER_CHAT_WIN);
    chatTracker.set(key, chatTs);
    if (chatTs.length >= PER_CHAT_MAX) {
        return { allowed: false, reason: 'chat_limit' };
    }

    return { allowed: true };
}

/**
 * Record an outgoing message (call AFTER successful send).
 *
 * @param {string} chatJid
 */
function recordOutgoing(chatJid) {
    const now = Date.now();
    const key = String(chatJid);

    // Per-chat
    const chatTs = chatTracker.get(key) || [];
    chatTs.push(now);
    chatTracker.set(key, chatTs);

    // Global
    globalTimestamps.push(now);

    // Daily
    dailyTimestamps.push(now);
}

// ── periodic cleanup (prevent memory leak on long-running bots) ─────────

setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of chatTracker) {
        const fresh = timestamps.filter(ts => now - ts < PER_CHAT_WIN);
        if (fresh.length === 0) chatTracker.delete(key);
        else chatTracker.set(key, fresh);
    }
    globalTimestamps = globalTimestamps.filter(ts => now - ts < GLOBAL_WIN);
    dailyTimestamps  = dailyTimestamps.filter(ts => now - ts < DAILY_WIN);
}, 60_000).unref();

module.exports = {
    canSendOutgoing,
    recordOutgoing,
    PER_CHAT_MAX,
    GLOBAL_MAX,
    DAILY_MAX,
};
