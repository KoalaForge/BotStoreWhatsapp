'use strict';

/**
 * WaBroadcastQueueService
 *
 * High-performance, tenant-isolated broadcast queue for sending WhatsApp messages
 * to large numbers of users.
 *
 * Adapted from Telegram's BroadcastQueueService with WhatsApp-specific rate limits:
 *  - 1 message per second (WhatsApp is much stricter than Telegram's 30/sec)
 *  - Sequential processing per job to respect rate limits
 *  - PER-JOB ISOLATION: each enqueue() creates an independent async chain
 *  - NON-BLOCKING: enqueue() returns a jobId immediately
 *  - PROGRESS TRACKING: sent/failed counters updated in real-time
 *  - MEMORY-SAFE: completed jobs auto-expire after 24 hours
 *
 * Throughput estimate:
 *   1,000 users  → ~1,000 sec  (~16.7 min)
 *   5,000 users  → ~5,000 sec  (~83 min)
 *
 * Usage:
 *   const jobId = waBroadcastQueueService.enqueue(sock, users, msgBuilder);
 *   const status = waBroadcastQueueService.getStatus(jobId);
 */

const crypto = require('crypto');
const clc    = require('cli-color');
const moment = require('moment-timezone');
const { randomInt, isHumanizeDisabled } = require('../utils/humanDelay');

const DELAY_MIN_MS        = 1500;           // Minimum gap between messages
const DELAY_MAX_MS        = 4000;           // Maximum gap between messages
const MICRO_BREAK_MIN     = 8;              // Send 8-15 msgs before micro-break
const MICRO_BREAK_MAX     = 15;
const MICRO_BREAK_MS_MIN  = 10_000;         // Micro-break: 10-30 seconds
const MICRO_BREAK_MS_MAX  = 30_000;
const LONG_BREAK_EVERY    = 50;             // Long break roughly every 50-80 msgs
const LONG_BREAK_MS_MIN   = 120_000;        // Long break: 2-5 minutes
const LONG_BREAK_MS_MAX   = 300_000;
const JOB_TTL_MS          = 24 * 3600_000;  // Keep completed jobs for 24 hours
const CLEANUP_INTERVAL_MS = 30 * 60_000;    // Run cleanup every 30 minutes

class WaBroadcastQueueService {
    constructor() {
        /** @type {Map<string, BroadcastJob>} */
        this._jobs = new Map();

        this._cleanupInterval = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
        if (typeof this._cleanupInterval.unref === 'function') {
            this._cleanupInterval.unref();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Enqueue a broadcast job. Returns immediately with a jobId.
     *
     * @param {Object} sock - Baileys WASocket instance
     * @param {Array<Object>} users - Recipients (must have idWhatsapp or idTelegram)
     * @param {(user: Object) => BroadcastMessage} messageBuilder
     *   Function called per user. Returns { text } or { image, caption? }.
     * @returns {string} jobId — 16-char hex string
     */
    enqueue(sock, users, messageBuilder) {
        const jobId = crypto.randomBytes(8).toString('hex');

        const job = {
            id:          jobId,
            status:      'processing',
            total:       users.length,
            sent:        0,
            failed:      0,
            createdAt:   new Date(),
            completedAt: null,
        };

        this._jobs.set(jobId, job);

        // Yield the event loop before starting so enqueue() always returns first
        setImmediate(() => this._process(job, sock, [...users], messageBuilder));

        return jobId;
    }

    /**
     * Get the current status snapshot of a broadcast job.
     * Returns null if the jobId is unknown or has expired.
     *
     * @param {string} jobId
     * @returns {BroadcastJob|null}
     */
    getStatus(jobId) {
        const job = this._jobs.get(jobId);
        return job ? { ...job } : null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Core processing loop — humanized.
     *
     * Anti-detection measures:
     *  1. Shuffle recipient order (no sequential phone-number patterns)
     *  2. Random delay between each message (1.5-4 s)
     *  3. Micro-breaks every 8-15 messages (10-30 s pause)
     *  4. Long breaks every ~50-80 messages (2-5 min pause)
     *  5. Presence set to 'available' during breaks (not perpetually typing)
     */
    async _process(job, sock, users, messageBuilder) {
        // Shuffle recipients so sends aren't in DB-insertion order
        this._shuffle(users);

        // Decide break cadences for this job (randomised per run)
        const microBreakEvery = randomInt(MICRO_BREAK_MIN, MICRO_BREAK_MAX);
        const longBreakEvery  = randomInt(LONG_BREAK_EVERY, LONG_BREAK_EVERY + 30);

        try {
            for (let i = 0; i < users.length; i++) {
                const sendStart = Date.now();

                await this._sendOne(sock, users[i], messageBuilder, job);

                const hasMore = i + 1 < users.length;
                if (!hasMore) break;

                // ── Long break (every ~50-80 msgs) ──
                if ((i + 1) % longBreakEvery === 0) {
                    const pause = randomInt(LONG_BREAK_MS_MIN, LONG_BREAK_MS_MAX);
                    this._log('INFO', `Job ${job.id}: long break ${Math.round(pause / 1000)}s after ${i + 1} msgs`);
                    try { await sock.sendPresenceUpdate('unavailable'); } catch {}
                    await this._sleep(pause);
                    try { await sock.sendPresenceUpdate('available'); } catch {}
                    continue; // long break already includes the per-message gap
                }

                // ── Micro break (every 8-15 msgs) ──
                if ((i + 1) % microBreakEvery === 0) {
                    const pause = randomInt(MICRO_BREAK_MS_MIN, MICRO_BREAK_MS_MAX);
                    this._log('INFO', `Job ${job.id}: micro-break ${Math.round(pause / 1000)}s after ${i + 1} msgs`);
                    try { await sock.sendPresenceUpdate('available'); } catch {}
                    await this._sleep(pause);
                    continue;
                }

                // ── Normal per-message delay (1.5-4 s) ──
                const gap = randomInt(DELAY_MIN_MS, DELAY_MAX_MS);
                const elapsed = Date.now() - sendStart;
                if (elapsed < gap) await this._sleep(gap - elapsed);
            }
        } catch (err) {
            job.status      = 'failed';
            job.completedAt = new Date();
            console.error(
                clc.red.bold('[ ERROR ]') +
                ` [${moment().format('HH:mm:ss')}]:` +
                clc.redBright(` [WaBroadcastQueue] Job ${job.id} fatal: ${err.message}`)
            );
            return;
        }

        job.status      = 'completed';
        job.completedAt = new Date();

        this._log('INFO',
            `Job ${job.id} completed — sent: ${job.sent}, failed: ${job.failed}, total: ${job.total}`
        );
    }

    /** Fisher-Yates shuffle (in-place). */
    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /** Consistent log helper. */
    _log(level, msg) {
        const colors = { INFO: clc.green.bold, WARN: clc.yellow.bold, ERROR: clc.red.bold };
        const prefix = (colors[level] || clc.white)(`[ ${level} ]`);
        console.log(`${prefix} [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`[WaBroadcastQueue] ${msg}`)}`);
    }

    /**
     * Send a single message to one user.
     * Errors are swallowed and counted in job.failed.
     */
    async _sendOne(sock, user, messageBuilder, job) {
        try {
            const jid = user.idWhatsapp || user.idTelegram;
            if (!jid) {
                job.failed++;
                return;
            }

            const msg = messageBuilder(user);
            if (msg.image) {
                await sock.sendMessage(jid, {
                    image: { url: msg.image },
                    caption: msg.caption || ''
                });
            } else {
                await sock.sendMessage(jid, { text: msg.text });
            }
            job.sent++;
        } catch {
            job.failed++;
        }
    }

    /** Remove completed/failed jobs older than JOB_TTL_MS */
    _cleanup() {
        const cutoff = Date.now() - JOB_TTL_MS;
        for (const [id, job] of this._jobs) {
            if (job.completedAt && job.completedAt.getTime() < cutoff) {
                this._jobs.delete(id);
            }
        }
    }

    _sleep(ms) {
        if (isHumanizeDisabled()) return Promise.resolve();
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Clean up the cleanup interval (useful in tests) */
    destroy() {
        clearInterval(this._cleanupInterval);
    }
}

/**
 * @typedef {Object} BroadcastJob
 * @property {string}    id
 * @property {'processing'|'completed'|'failed'} status
 * @property {number}    total
 * @property {number}    sent
 * @property {number}    failed
 * @property {Date}      createdAt
 * @property {Date|null} completedAt
 */

/**
 * @typedef {Object} BroadcastMessage
 * @property {string}  [text]    - Text content (required if no image)
 * @property {string}  [image]   - Image URL (required if no text)
 * @property {string}  [caption] - Caption for image messages
 */

// Singleton — one instance per Node.js process
module.exports = new WaBroadcastQueueService();
