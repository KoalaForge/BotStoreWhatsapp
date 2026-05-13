'use strict';

/**
 * Human-like delay utilities for WhatsApp anti-detection.
 *
 * Delays use Gaussian-like distribution so timing varies naturally
 * around a mean, avoiding fixed-interval patterns.
 *
 * Tunable via env vars (all values in ms):
 *   WA_HUMANIZE_DISABLED   - "true" → skip delays entirely (instant replies)
 *   WA_TYPING_MIN_MS       - typingDelay floor   (default 100)
 *   WA_TYPING_MAX_MS       - typingDelay ceiling (default 600)
 *   WA_IDLE_MIN_MS         - empty-msg humanDelay floor   (default 100)
 *   WA_IDLE_MAX_MS         - empty-msg humanDelay ceiling (default 300)
 *   WA_BACKOFF_MIN_MS      - rate-limit backoff floor   (default 800)
 *   WA_BACKOFF_MAX_MS      - rate-limit backoff ceiling (default 2000)
 */

const DISABLED = String(process.env.WA_HUMANIZE_DISABLED).toLowerCase() === 'true';

function envInt(name, fallback) {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const TYPING_MIN = envInt('WA_TYPING_MIN_MS', 100);
const TYPING_MAX = envInt('WA_TYPING_MAX_MS', 600);
const IDLE_MIN   = envInt('WA_IDLE_MIN_MS', 100);
const IDLE_MAX   = envInt('WA_IDLE_MAX_MS', 300);
const BACKOFF_MIN = envInt('WA_BACKOFF_MIN_MS', 800);
const BACKOFF_MAX = envInt('WA_BACKOFF_MAX_MS', 2000);

function isHumanizeDisabled() {
    return DISABLED;
}

function humanDelay(minMs, maxMs) {
    if (DISABLED) return Promise.resolve();
    const lo = minMs ?? IDLE_MIN;
    const hi = maxMs ?? IDLE_MAX;
    const ms = _gaussian(lo, hi);
    return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffDelay() {
    if (DISABLED) return Promise.resolve();
    const ms = _gaussian(BACKOFF_MIN, BACKOFF_MAX);
    return new Promise(resolve => setTimeout(resolve, ms));
}

function typingDelay(charCount) {
    if (DISABLED) return Promise.resolve();
    const wpm = 40 + Math.random() * 30;
    const charsPerSec = (wpm * 5) / 60;
    const baseMs = (charCount / charsPerSec) * 1000;
    const clamped = Math.max(TYPING_MIN, Math.min(TYPING_MAX, baseMs));
    const jittered = clamped * (0.85 + Math.random() * 0.3);
    return new Promise(resolve => setTimeout(resolve, Math.round(jittered)));
}

function jitteredDelay(baseMs, factor = 0.3) {
    if (DISABLED) return Promise.resolve();
    const low  = baseMs * (1 - factor);
    const high = baseMs * (1 + factor);
    const ms = Math.round(low + Math.random() * (high - low));
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _gaussian(min, max) {
    if (min >= max) return min;
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const g  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mean   = (min + max) / 2;
    const stddev = (max - min) / 6;
    const value  = Math.round(mean + g * stddev);
    return Math.max(min, Math.min(max, value));
}

module.exports = {
    humanDelay,
    typingDelay,
    jitteredDelay,
    backoffDelay,
    randomInt,
    isHumanizeDisabled,
};
