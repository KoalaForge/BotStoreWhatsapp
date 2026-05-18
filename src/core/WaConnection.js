const { Boom } = require('@hapi/boom');
const clc = require('cli-color');
const moment = require('moment-timezone');
const pino = require('pino');
const { NodeCache } = require('@cacheable/node-cache');
const { useMongoAuthState } = require('../whatsapp/mongoAuthState');
const { loadBaileys } = require('../whatsapp/baileysLoader');
const { EventEmitter } = require('events');
const { sendWebhook } = require('../services/webhookNotificationService');
const groupGreetingService = require('../services/groupGreetingService');
const { humanDelay, jitteredDelay, randomInt } = require('../utils/humanDelay');
const {
    getCachedGroupMetadata,
    setCachedGroupMetadata,
    invalidateGroupMetadata,
    invalidateAllForSock,
    dropCacheForBot: dropGroupMetaCache,
} = require('../utils/groupMetadataCache');
const qrcode = require('qrcode');

// Events that are too large or too sensitive to forward via the raw passthrough.
// `creds.update` contains noise/identity keys + thousands of preKeys (~650KB
// per emit, ~50ms to serialize) and fires repeatedly during pairing — leaving
// it on causes WS keepalive misses (408/428) on slow event loops. Integrators
// who need these can subscribe to the high-level `bot_*` events instead.
const RAW_FORWARD_BLACKLIST = new Set([
    'creds.update',
    'messaging-history.set'
]);

// Realistic browser fingerprints — picked at random per connection
const BROWSER_PROFILES = [
    ['Windows', 'Chrome', '131.0.6778.86'],
    ['Windows', 'Edge', '131.0.2903.70'],
    ['Windows', 'Chrome', '130.0.6723.117'],
    ['macOS', 'Safari', '18.1.1'],
    ['macOS', 'Chrome', '131.0.6778.86'],
    ['Ubuntu', 'Firefox', '133.0'],
];

const log = (level, msg) => {
    const colors = { INFO: clc.green.bold, WARN: clc.yellow.bold, ERROR: clc.red.bold };
    const prefix = (colors[level] || clc.white)(`[ ${level} ]`);
    console.log(`${prefix} [${moment().format('HH:mm:ss')}]: ${clc.blueBright(msg)}`);
};

/**
 * WaConnection - Wrapper class for a single WhatsApp connection.
 * Equivalent of BotInstance in the Telegram project.
 *
 * Manages a Baileys WebSocket connection with:
 * - MongoDB-backed auth state (encrypted)
 * - Auto-reconnect on connection loss
 * - QR code / pairing code emission for initial setup
 * - Message routing via callback
 */
class WaConnection extends EventEmitter {
    /**
     * @param {Object} opts
     * @param {string} opts.botId - MongoDB _id of the UserWhatsappBot
     * @param {string} opts.userId - Owner user ID
     * @param {string} opts.phoneNumber - WhatsApp phone number
     * @param {Function} opts.onMessage - Callback for incoming messages: (sock, message, botId) => void
     */
    constructor({ botId, userId, phoneNumber, onMessage, webhookConfig, browserProfile }) {
        super();
        this.botId = botId;
        this.userId = userId;
        this.phoneNumber = phoneNumber;
        this.onMessage = onMessage;
        // webhookConfig: { url, events, secret }
        this._webhookConfig = this._buildWebhookConfig(webhookConfig);
        this.sock = null;
        this.isRunning = false;
        this.startedAt = null;
        this._authState = null;
        this._saveCreds = null;
        this._clearAuth = null;
        this._reconnectAttempts = 0;
        // 24/7 SaaS: never give up reconnecting. Soft threshold only escalates
        // log severity + fires `bot_reconnect_warning` webhook so operators
        // still see prolonged outages. Loop continues until `loggedOut`.
        this._reconnectWarnAt = 10;
        this._reconnectWarningEmitted = false;
        this._intentionalClose = false;
        this._presenceInterval = null;
        // Circuit breaker for 408/connectionLost after a successful `open`.
        // Healthy sessions never hit this — 408 takes ~30s of dead keepalive
        // to fire, so 3× in 2 min is structurally impossible without a deeper
        // problem. When tripped, escalate to the unbounded backoff path so we
        // stop hammering with fast retries.
        this._timeoutWindow = [];
        this._timeoutWindowMs = 120_000;
        this._timeoutWindowMax = 3;
        this._lastOpenAt = 0;
        // getMessage cache (Step 2): in-memory LRU for outgoing ciphertext so
        // Baileys can satisfy peer retry receipts after socket restart.
        this._sentMsgCache = new Map();
        this._sentMsgCacheMax = 2000;
        // msgRetryCounter (Step 3): hard cap on retry receipts per message
        // to prevent retry storms desyncing sessions further.
        this._retryCounterCache = new Map();
        // Decrypt failure tracker (Step 4-5): jid → { count, firstAt }.
        // Triggers session purge when threshold hit.
        this._decryptFailures = new Map();
        // Watchdog (Step 6): force WS restart if no events received while
        // state=connected. Updated by every relevant event.
        this._lastEventAt = 0;
        this._watchdogInterval = null;
        // Session purge handle, captured from useMongoAuthState() in start().
        this._purgePeerSession = null;
        // Throttle decrypt-failure logs per peer so a single desynced peer in
        // a busy group can't flood the console after a 408 reconnect.
        this._decryptLogLast = new Map();
        // Circuit breaker per-peer: when purge fails to fix the desync (some
        // libsignal states recreate the broken ratchet — community Issue
        // #2234), this silences both log + purge churn for 5 min so the bot
        // stays responsive. peerJid → silence_until_ts.
        this._decryptCircuit = new Map();
        this._decryptCircuitThreshold = 10;
        this._decryptCircuitSilenceMs = 5 * 60_000;
        // Per-WaConnection user-device + media caches. Persist across
        // reconnects so USync queries (1000-member groups → 1000 device
        // lookups per send) don't refetch on every transient WS drop.
        // 24h TTL: device lists change only when a peer adds/removes a
        // linked device, which is rare.
        this._userDevicesCache = new NodeCache({
            stdTTL: 86400,
            useClones: false,
            checkperiod: 600,
        });
        this._mediaCache = new NodeCache({
            stdTTL: 86400,
            useClones: false,
            checkperiod: 600,
        });
        // Pin device identity for the lifetime of this instance — Baileys
        // pairing breaks if the browser fingerprint changes mid-session.
        // Prefer the persisted profile from DB so reconnects/restarts keep
        // the same identity that WhatsApp originally registered.
        this._browserProfile = (Array.isArray(browserProfile) && browserProfile.length === 3)
            ? browserProfile
            : BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
    }

    /**
     * Returns the device fingerprint pinned for this instance, e.g.
     * `['Windows', 'Chrome', '131.0.6778.86']`. WaBotManager persists this
     * to the bot record after first start so future restarts can reuse it.
     */
    getBrowserProfile() {
        return this._browserProfile;
    }

    /**
     * Register a callback invoked on every connection-state transition. The
     * persister receives one of: 'idle' | 'connecting' | 'connected' |
     * 'disconnected' | 'reconnecting' | 'logged_out' | 'failed'. Storage-
     * agnostic so SINGLE and MULTI can each persist to their own document.
     */
    setStatePersister(fn) {
        this._statePersister = fn;
    }

    /** Current cached state, or 'idle' if no transition has fired yet. */
    getState() {
        return this._state || 'idle';
    }

    /** Internal: update cached state and fire the persister (fire-and-forget). */
    _setState(state) {
        if (this._state === state) return;
        this._state = state;
        if (this._statePersister) {
            Promise.resolve(this._statePersister(state)).catch(() => {});
        }
    }

    /**
     * Normalize the per-bot webhook config and bake in identity fields so
     * the service layer doesn't need to look anything up.
     */
    _buildWebhookConfig(cfg) {
        if (!cfg || !cfg.url) return null;
        return {
            url: cfg.url,
            events: Array.isArray(cfg.events) && cfg.events.length ? cfg.events : ['*'],
            secret: cfg.secret || null,
            botId: this.botId,
            phoneNumber: this.phoneNumber
        };
    }

    /**
     * Replace the webhook config on a running instance. Called by
     * WaBotManager.updateBot when the integrator changes webhook settings.
     */
    setWebhookConfig(cfg) {
        this._webhookConfig = this._buildWebhookConfig(cfg);
    }

    /**
     * Forward an event to the configured webhook (subject to subscription
     * filtering inside sendWebhook). Safe no-op when no webhook is set.
     */
    _emit(eventName, data) {
        if (!this._webhookConfig) return;
        sendWebhook(this._webhookConfig, eventName, data);
    }

    // ── Reconnect scheduler ──────────────────────────────────────────────────
    // Unbounded retry with capped exp backoff. Only `loggedOut` permanently
    // stops the bot (handled in connection.update). After `_reconnectWarnAt`
    // consecutive failures we surface `bot_reconnect_warning` so operators
    // see prolonged outages without the bot dying.
    _scheduleReconnect(options, statusCode) {
        const n = this._reconnectAttempts;
        const expIdx = Math.min(n, 6);             // cap exp growth at 2^6
        const base = Math.min(2000 * Math.pow(2, Math.max(0, expIdx - 1)), 120_000);
        const delay = Math.round(base * (0.7 + Math.random() * 0.6));

        const level = n >= this._reconnectWarnAt ? 'ERROR' : 'WARN';
        log(level, `Bot ${this.botId} disconnected (code ${statusCode}). Reconnecting in ${delay}ms (attempt ${n})...`);

        if (n >= this._reconnectWarnAt && !this._reconnectWarningEmitted) {
            this._reconnectWarningEmitted = true;
            this._emit('bot_reconnect_warning', {
                attempts: n,
                status_code: statusCode,
                threshold: this._reconnectWarnAt
            });
        }

        this._setState('reconnecting');
        setTimeout(() => this._connect(options), delay);
    }

    // ── Sent-message cache (getMessage support) ──────────────────────────────
    // Baileys calls getMessage(key) to satisfy peer retry receipts; without a
    // cache it returns undefined → counter drift → "Bad MAC" / "Failed to
    // decrypt" on the peer side. LRU-evict by re-inserting on access (Map
    // preserves insertion order). Memory budget: ~2000 × ~2KB ≈ 4MB/bot.
    _cacheKey(key) {
        return `${key.remoteJid}:${key.id}`;
    }
    _cacheSent(key, message) {
        if (!key || !key.id || !key.remoteJid || !message) return;
        const k = this._cacheKey(key);
        if (this._sentMsgCache.has(k)) this._sentMsgCache.delete(k);
        this._sentMsgCache.set(k, message);
        while (this._sentMsgCache.size > this._sentMsgCacheMax) {
            const oldest = this._sentMsgCache.keys().next().value;
            if (oldest === undefined) break;
            this._sentMsgCache.delete(oldest);
        }
    }
    _getSent(key) {
        if (!key || !key.id || !key.remoteJid) return undefined;
        return this._sentMsgCache.get(this._cacheKey(key));
    }

    // ── Decrypt-failure tracker + auto session purge ─────────────────────────
    // When a peer accumulates ≥ 3 ciphertext decode failures within 5 min we
    // delete its session-* docs from Mongo. Next inbound message from that
    // peer triggers a clean prekey bundle exchange — no re-pair needed.
    async _recordDecryptFailure(jid, messageId, participant) {
        if (!jid) return;
        // For group messages, the desynced peer is in `participant`, not the
        // group JID. Resolving here lets us purge that peer's pairwise session
        // and stop the Bad MAC storm — without this, every subsequent group
        // msg from the same peer regenerates the same decrypt failure.
        const peerJid = (typeof jid === 'string' && jid.endsWith('@g.us') && participant)
            ? participant
            : jid;

        // Circuit-breaker: if purge keeps failing for this peer, stop logging
        // + stop attempting purges. Lets Baileys internal retry handle it and
        // keeps the bot responsive instead of burning CPU on a hopeless peer.
        const silenceUntil = this._decryptCircuit.get(peerJid);
        if (silenceUntil && Date.now() < silenceUntil) return;
        if (silenceUntil && Date.now() >= silenceUntil) {
            this._decryptCircuit.delete(peerJid);
        }

        const now = Date.now();
        const entry = this._decryptFailures.get(peerJid) || { count: 0, firstAt: now };
        // Reset window if last failure was > 5 min ago.
        if (now - entry.firstAt > 5 * 60_000) {
            entry.count = 0;
            entry.firstAt = now;
        }
        entry.count += 1;
        this._decryptFailures.set(peerJid, entry);

        // Throttle log to once per 30s per peer — a single desynced participant
        // in a busy group can fire dozens of failures back-to-back.
        const lastLog = this._decryptLogLast.get(peerJid) || 0;
        if (now - lastLog > 30_000) {
            this._decryptLogLast.set(peerJid, now);
            log('WARN', `Decrypt failure for bot ${this.botId} from ${peerJid} (count=${entry.count}, msg=${messageId || 'n/a'})`);
        }
        this._emit('decrypt_error', { from: peerJid, message_id: messageId || null, count: entry.count });

        // Trip the circuit when failures pile up — purge isn't fixing it.
        if (entry.count >= this._decryptCircuitThreshold) {
            this._decryptCircuit.set(peerJid, now + this._decryptCircuitSilenceMs);
            log('WARN', `Decrypt circuit-breaker tripped for ${peerJid} (bot ${this.botId}). Silencing ${Math.round(this._decryptCircuitSilenceMs / 60_000)}min.`);
            this._emit('decrypt_circuit_tripped', { jid: peerJid, count: entry.count });
            return;
        }

        // Purge real peer sessions (DM peers — `@s.whatsapp.net`). Includes
        // group participants resolved above.
        const isDm = typeof peerJid === 'string' && peerJid.endsWith('@s.whatsapp.net');
        if (isDm && entry.count >= 3 && this._purgePeerSession) {
            try {
                await this._purgePeerSession(peerJid);
                this._decryptFailures.delete(peerJid);
                this._decryptLogLast.delete(peerJid);
                log('INFO', `Purged stale session for ${peerJid} (bot ${this.botId}). Peer prekey bundle will create a fresh session.`);
                this._emit('session_purged', { jid: peerJid });
            } catch (err) {
                log('ERROR', `Failed to purge session for ${peerJid} (bot ${this.botId}): ${err.message}`);
            }
        }
    }

    // ── Health watchdog ──────────────────────────────────────────────────────
    // Forces WS restart if the connection appears alive but receives nothing
    // for 5 min. Triggers the existing reconnect path (unbounded) — does NOT
    // clear creds. Also prunes stale entries in the retry / failure caches.
    _touchEvent() {
        this._lastEventAt = Date.now();
    }
    _startWatchdog() {
        this._stopWatchdog();
        this._lastEventAt = Date.now();
        this._watchdogInterval = setInterval(() => {
            try {
                this._pruneCaches();
                if (this._state !== 'connected') return;
                const idle = Date.now() - this._lastEventAt;
                if (idle > 5 * 60_000) {
                    log('WARN', `Watchdog: bot ${this.botId} idle ${Math.round(idle / 1000)}s while state=connected — forcing WS restart.`);
                    this._emit('watchdog_restart', { idle_ms: idle });
                    try {
                        if (this.sock?.ws?.close) this.sock.ws.close();
                        else if (typeof this.sock?.end === 'function') this.sock.end(undefined);
                    } catch (_) { /* best-effort */ }
                }
            } catch (_) { /* watchdog must never throw */ }
        }, 60_000);
        if (typeof this._watchdogInterval.unref === 'function') {
            this._watchdogInterval.unref();
        }
    }
    _stopWatchdog() {
        if (this._watchdogInterval) {
            clearInterval(this._watchdogInterval);
            this._watchdogInterval = null;
        }
    }
    _pruneCaches() {
        // Retry counter entries are tiny but unbounded over time. Cap by size.
        if (this._retryCounterCache.size > 2000) {
            const toDrop = this._retryCounterCache.size - 1500;
            const it = this._retryCounterCache.keys();
            for (let i = 0; i < toDrop; i++) {
                const k = it.next().value;
                if (k === undefined) break;
                this._retryCounterCache.delete(k);
            }
        }
        // Decay decrypt-failure windows older than 10 min.
        const cutoff = Date.now() - 10 * 60_000;
        for (const [jid, entry] of this._decryptFailures) {
            if (entry.firstAt < cutoff) this._decryptFailures.delete(jid);
        }
    }

    /**
     * Prewarm group metadata cache via a single bulk query. Returns true on
     * success, false on guard failure or error (caller may retry).
     */
    async _prewarmGroupCache() {
        if (!this.sock || !this.isRunning) return false;
        if (this.sock.ws?.readyState !== 1) return false;
        try {
            const allMeta = await this.sock.groupFetchAllParticipating();
            const count = Object.keys(allMeta || {}).length;
            for (const [jid, meta] of Object.entries(allMeta || {})) {
                setCachedGroupMetadata(this.sock, jid, meta);
            }
            log('INFO', `Prewarmed group metadata cache: ${count} group(s) for ${this.botId}`);
            return true;
        } catch (err) {
            log('WARN', `Group metadata prewarm failed for ${this.botId}: ${err?.message} — fallback to lazy`);
            return false;
        }
    }

    /**
     * Internal: actually fire requestPairingCode on the live sock. Adds a
     * brief settle delay so the noise handshake has a chance to complete
     * after `connection: 'connecting'` fires.
     */
    async _requestPairingCode() {
        await new Promise(r => setTimeout(r, 2000));
        if (!this.sock) {
            const err = new Error('Socket not initialized');
            this.emit('pairingError', err);
            this._emit('pairing_code_error', { message: err.message });
            return;
        }
        if (!this.phoneNumber) {
            const err = new Error('phone_number not set — call POST /api/bots/create with phone_number first');
            this.emit('pairingError', err);
            this._emit('pairing_code_error', { message: err.message });
            return;
        }
        try {
            const cleanNumber = this.phoneNumber.replace(/[^0-9]/g, '');
            const code = await this.sock.requestPairingCode(cleanNumber);
            log('INFO', `Pairing code for bot ${this.botId}: ${code}`);
            this.emit('pairingCode', code);
            // WhatsApp displays the 8-char code as XXXX-XXXX in the UI.
            const codeFormatted = code.length === 8
                ? `${code.slice(0, 4)}-${code.slice(4)}`
                : code;
            this._emit('pairing_code_generated', {
                code,
                code_formatted: codeFormatted,
                phone_number: cleanNumber
            });
        } catch (err) {
            log('ERROR', `Failed to request pairing code for bot ${this.botId}: ${err.message}`);
            this.emit('pairingError', err);
            this._emit('pairing_code_error', { message: err.message });
        }
    }

    /**
     * Public: trigger a pairing-code request safely. If the socket is not yet
     * past noise handshake, queue the request to fire on the next 'connecting'
     * update. Used by POST /api/bots/:id/pairing-code.
     * @returns {Promise<string>} resolves with the code, rejects on error/timeout
     */
    requestPairingCode() {
        return new Promise((resolve, reject) => {
            const onCode = (code) => { cleanup(); resolve(code); };
            const onErr = (err) => { cleanup(); reject(err); };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Pairing code request timed out after 15s'));
            }, 15_000);
            const cleanup = () => {
                clearTimeout(timer);
                this.removeListener('pairingCode', onCode);
                this.removeListener('pairingError', onErr);
            };
            this.once('pairingCode', onCode);
            this.once('pairingError', onErr);
            // Either fire now (sock ready) or arm auto-request for next 'connecting'.
            if (this.sock && !this._pairingCodeRequested) {
                this._pairingCodeRequested = true;
                this._requestPairingCode().catch(() => {});
            } else {
                this._autoRequestPairing = true;
                this._pairingCodeRequested = false;
            }
        });
    }

    /**
     * Start the WhatsApp connection.
     * Loads auth state from MongoDB; if no session exists, emits QR / pairing code events.
     * @param {Object} [options]
     * @param {boolean} [options.pairingCode] - If true, request pairing code instead of QR
     * @returns {Promise<void>}
     */
    async start(options = {}) {
        const { state, saveCreds, clearAll, purgePeerSession } = await useMongoAuthState(this.botId);
        this._authState = state;
        this._saveCreds = saveCreds;
        this._clearAuth = clearAll;
        this._purgePeerSession = purgePeerSession;

        this._intentionalClose = false;
        this._reconnectAttempts = 0;
        this._reconnectWarningEmitted = false;
        this._autoRequestPairing = options.pairingCode === true;
        this._pairingCodeRequested = false;
        this._setState('connecting');
        await this._connect(options);
    }

    /**
     * Internal: create the Baileys socket and bind events.
     */
    async _connect(options = {}) {
        const baileys = await loadBaileys();
        const makeWASocket = baileys.default || baileys.makeWASocket;
        const { DisconnectReason, fetchLatestBaileysVersion, WAMessageStubType, makeCacheableSignalKeyStore } = baileys;
        // Stash for use in connection.update / messages.upsert handlers below.
        this._DisconnectReason = DisconnectReason;
        // CIPHERTEXT stub fires when Baileys gives up decrypting a message.
        // Numeric fallback (1) handles odd v6→v7 enum-export inconsistencies.
        const CIPHERTEXT_STUB = WAMessageStubType?.CIPHERTEXT ?? 1;

        const { version } = await fetchLatestBaileysVersion();

        const logLevel = process.env.BAILEYS_DEBUG === 'true' ? 'debug' : 'silent';
        const logger = pino({ level: logLevel });

        // Fully terminate the previous socket so its WebSocket is closed
        // BEFORE we open a new one. Without this, after a code 515 (restart
        // required) the old WS lingers briefly with the same creds; the
        // server sees two concurrent sessions for the same device and kicks
        // one — surfacing as a phantom code 408 right after `connection:
        // 'open'` and looping forever.
        const oldSock = this.sock;
        if (oldSock) {
            try {
                // Detach our handlers first so we don't re-enter on the
                // close emit triggered by end().
                oldSock.ev?.removeAllListeners?.();
                if (typeof oldSock.end === 'function') {
                    await oldSock.end(undefined);
                }
            } catch (_) { /* old sock cleanup is best-effort */ }
            this.sock = null;
        }

        // Resolve group allowlist once per socket build. When set, Baileys
        // ignores groups outside the list — protects the event loop from
        // chatter in large public groups where the bot has no business.
        const groupAllowlist = (process.env.WA_GROUP_ALLOWLIST || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const groupAllowSet = new Set(groupAllowlist);

        // Forward-declare socket reference so cachedGroupMetadata can resolve
        // it via closure (this.sock is reassigned by makeWASocket below).
        let socketRef = null;

        // Wrap signal key store with in-memory LRU. Without this, every
        // decrypt + every encrypt round-trips to Mongo to fetch session keys
        // — easily 5-20ms per op, blocks the event loop, and starves keepalive
        // → 408. The wrapper is the canonical Baileys recommendation; auth
        // state persistence stays in mongoAuthState (the wrapper writes
        // through).
        const cachedAuth = makeCacheableSignalKeyStore
            ? { creds: this._authState.creds, keys: makeCacheableSignalKeyStore(this._authState.keys, logger) }
            : this._authState;

        this.sock = makeWASocket({
            version,
            auth: cachedAuth,
            logger,
            browser: this._browserProfile,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            // Keep markOnline true so server doesn't kick the WS as idle.
            // Manual presence update in 'open' handler is a belt-and-braces
            // safety against the rc10 open→408 race seen in issue #2254.
            markOnlineOnConnect: true,
            keepAliveIntervalMs: 30_000,           // Baileys default
            connectTimeoutMs: 60_000,
            // 90s (was 60s) — USync device-list queries on 1000-member groups
            // can take 30-60s on slow networks. Tighter timeout aborts the
            // send mid-flight which triggers a reconnect storm.
            defaultQueryTimeoutMs: 90_000,
            retryRequestDelayMs: 2_000,
            // Don't re-emit our own outbound messages back into the upsert
            // handler — saves one decode + filter pass per send. Receivers
            // still see them (server echoes to other devices).
            emitOwnEvents: false,
            // Skip MAC verification of app-state patches/snapshots. Verifying
            // every mutation is CPU-heavy and unnecessary when the auth state
            // is already encrypted at rest (mongoAuthState).
            appStateMacVerification: { patch: false, snapshot: false },
            // getMessage backed by in-memory LRU cache — lets Baileys answer
            // peer retry receipts with the original ciphertext after a socket
            // restart, breaking the "counter drift → Bad MAC" cycle.
            getMessage: async (key) => this._getSent(key),
            // Cached group metadata — Baileys calls this during decryption /
            // sender-key resolution; without a cache it round-trips to the
            // server and parses a 100KB+ payload for every group message in
            // large groups. Repeated parse blocks the event loop and starves
            // keepalive (→ code 408 disconnects).
            cachedGroupMetadata: async (jid) => getCachedGroupMetadata(socketRef, jid),
            // Persistent device-list cache. Without this, sending to a
            // 1000-member group triggers 1000 USync device lookups every
            // single time — minutes of round-trips and event-loop block.
            userDevicesCache: this._userDevicesCache,
            // Persistent media upload cache — reuse upload result for the
            // same media buffer across sends (e.g. catalog banner).
            mediaCache: this._mediaCache,
            // Hard cap retry receipts per message at 3 to prevent retry storms
            // that further desync sessions.
            msgRetryCounterCache: {
                get: (k) => this._retryCounterCache.get(k),
                set: (k, v) => {
                    if (typeof v === 'number' && v > 3) return;
                    this._retryCounterCache.set(k, v);
                }
            },
            // Skip status broadcast traffic — never useful, just noise that
            // burns retry-receipt budget on irrelevant ciphertexts.
            // When WA_GROUP_ALLOWLIST is set, also ignore groups outside it.
            shouldIgnoreJid: (jid) => {
                if (jid === 'status@broadcast') return true;
                if (typeof jid !== 'string') return false;
                if (jid.endsWith('@broadcast')) return true;
                if (groupAllowSet.size > 0 && jid.endsWith('@g.us') && !groupAllowSet.has(jid)) return true;
                return false;
            },
        });
        socketRef = this.sock;
        // Tag the sock so cache helpers (groupMetadataCache, groupAdminIndex)
        // can resolve botId without callers threading it through. Cache keys
        // by botId so they survive sock recreation on reconnect.
        this.sock._botId = this.botId;

        // -- Connection update events --
        this.sock.ev.on('connection.update', async (update) => {
            this._touchEvent();
            const { connection, lastDisconnect, qr } = update;

            if (qr && !options.pairingCode) {
                this.emit('qr', qr);
                if (process.env.WA_PRINT_QR_TERMINAL === 'true') {
                    log('INFO', `QR code generated for bot ${this.botId} (${this.phoneNumber})`);
                }
                // Render QR to base64 PNG so the integrator can display it
                // directly without needing a QR library on their side.
                const qrImageBase64 = await qrcode.toDataURL(qr, {
                    margin: 1,
                    width: 300,
                    errorCorrectionLevel: 'M'
                }).catch(() => null);
                this._emit('qr_generated', {
                    qr,                                     // raw QR string
                    qr_image_base64: qrImageBase64          // data:image/png;base64,...
                });
                // Terminal QR print is opt-in (WA_PRINT_QR_TERMINAL=true). API
                // consumers (WebSocket /ws/single/qr or MULTI /ws/qr/:botId)
                // get the same QR via the 'qr' event without terminal noise.
                if (process.env.WA_PRINT_QR_TERMINAL === 'true') {
                    try {
                        const qrTerm = require('qrcode-terminal');
                        qrTerm.generate(qr, { small: true });
                    } catch (_) { /* qrcode-terminal optional */ }
                }
            }

            // Pairing-code flow: defer requestPairingCode until the WS reaches
            // 'connecting' (noise handshake done). Calling it earlier triggers
            // "Connection Closed" because sendNode runs before the socket is
            // ready to send. Guarded so we only fire once per session.
            if (connection === 'connecting'
                && this._autoRequestPairing
                && !this._pairingCodeRequested
                && this.phoneNumber
                && !this._authState.creds.registered) {
                this._pairingCodeRequested = true;
                this._requestPairingCode().catch(() => {});
            }

            if (connection === 'open') {
                this.isRunning = true;
                this.startedAt = new Date();
                this._reconnectAttempts = 0;
                this._reconnectWarningEmitted = false;
                this._lastOpenAt = Date.now();
                this._timeoutWindow = [];
                // Tag sock open timestamp so _sendWithRetry can apply a short
                // grace period — sending in the first ~2s after open often
                // hits 428 "Connection Closed" while the server-side device
                // slot finishes settling.
                if (this.sock) this.sock._openedAt = Date.now();
                this._startWatchdog();
                log('INFO', `WhatsApp connected: ${this.botId} (${this.phoneNumber})`);
                this._setState('connected');
                this.emit('connected');
                this._emit('bot_connected', {
                    started_at: this.startedAt.toISOString(),
                    user_jid: this.sock?.user?.id || null,
                    user_name: this.sock?.user?.name || null
                });

                // Manual presence update — replaces makeWASocket's
                // markOnlineOnConnect (disabled to dodge the rc10 open→408
                // race). Small delay lets the server fully register the
                // session before we send the presence node.
                setTimeout(() => {
                    if (this.sock && this.isRunning) {
                        this.sock.sendPresenceUpdate('available').catch(() => {});
                    }
                }, 1_000);

                // Start periodic presence simulation (human online/offline pattern)
                this._startPresenceSimulation();

                // Prewarm group metadata cache for every group the bot is in.
                // Without this, the first send to any group after (re)connect
                // falls through to a fresh server fetch — and on a freshly
                // reconnected socket that fetch often returns 428 "Connection
                // Closed" because the server-side device slot is still
                // settling. One groupFetchAllParticipating() seeds the cache
                // for ALL groups in a single query.
                //
                // 3s settle delay + 1 retry at 5s + readyState guard mirrors
                // the mitigation pattern from Baileys community issues #1407
                // and #1976. If both attempts fail, the lazy prewarm path
                // (index.js incoming-msg hook) still warms the cache before
                // the reply send.
                const triggerPrewarm = (delay) => setTimeout(async () => {
                    const ok = await this._prewarmGroupCache();
                    if (!ok && delay === 3_000) {
                        setTimeout(() => this._prewarmGroupCache(), 5_000);
                    }
                }, delay);
                triggerPrewarm(3_000);
            }

            if (connection === 'close') {
                this.isRunning = false;
                // Null the sock ref + detach listeners + end() immediately so
                // external consumers (tx processor, broadcast controller,
                // in-flight handlers) can't operate on the dead WS during the
                // reconnect wait. Mirrors _connect()'s old-sock cleanup so the
                // server-side device slot is released right away.
                const deadSock = this.sock;
                this.sock = null;
                if (deadSock) {
                    try { deadSock.ev?.removeAllListeners?.(); } catch (_) { /* best-effort */ }
                    try { deadSock.end?.(undefined); } catch (_) { /* best-effort */ }
                }
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : lastDisconnect?.error?.output?.statusCode || 500;

                const DR = this._DisconnectReason;

                // Code 515 = restartRequired. Baileys emits this immediately
                // after pairing handshake; the only correct response is an
                // immediate socket restart with the same auth + device id.
                if (statusCode === DR.restartRequired) {
                    log('INFO', `Bot ${this.botId} restart required (code 515). Reconnecting immediately.`);
                    this._setState('reconnecting');
                    // setImmediate races server-side session release — give the
                    // device slot ~1.5s to clear before reattaching with same
                    // auth/device id, otherwise the new session gets kicked
                    // with a phantom 408 ~30s after `open`.
                    setTimeout(() => this._connect(options), 1_500);
                    return;
                }

                // Code 408 = timedOut/connectionLost. Common transient WS drop
                // (often right after `open` on Baileys v7 RC). Reconnect fast
                // without burning a retry slot — but trip a circuit breaker
                // if it repeats so we don't loop forever.
                if (statusCode === DR.timedOut || statusCode === DR.connectionLost) {
                    const now = Date.now();
                    if (this._lastOpenAt > 0) {
                        this._timeoutWindow = this._timeoutWindow.filter(t => now - t < this._timeoutWindowMs);
                        this._timeoutWindow.push(now);
                    }

                    if (this._timeoutWindow.length >= this._timeoutWindowMax) {
                        log('WARN', `Bot ${this.botId} hit ${this._timeoutWindowMax} timeouts in ${this._timeoutWindowMs / 1000}s after open — escalating to backoff.`);
                        this._timeoutWindow = [];
                        this._reconnectAttempts++;
                        this._scheduleReconnect(options, statusCode);
                        return;
                    }

                    log('INFO', `Bot ${this.botId} connection timed out (code ${statusCode}). Reconnecting immediately.`);
                    this._setState('reconnecting');
                    // 1s wasn't enough on slow networks — 2.5s gives the server
                    // time to evict the dead session before we reattach.
                    setTimeout(() => this._connect(options), 2_500);
                    return;
                }

                const shouldReconnect = statusCode !== DR.loggedOut;

                if (statusCode === DR.loggedOut) {
                    log('WARN', `Bot ${this.botId} logged out. Session invalidated. Needs re-pairing.`);
                    this._stopWatchdog();
                    await this._clearAuth();
                    // Group metadata + derived index live by botId across
                    // reconnects — only drop when the bot identity is gone.
                    dropGroupMetaCache(this.botId);
                    this._setState('logged_out');
                    this.emit('loggedOut');
                    this._emit('bot_logged_out', { status_code: statusCode });
                } else if (shouldReconnect && !this._intentionalClose) {
                    this._reconnectAttempts++;
                    this._scheduleReconnect(options, statusCode);
                } else {
                    log('INFO', `Bot ${this.botId} connection closed intentionally.`);
                    this._setState('disconnected');
                    this._emit('bot_disconnected', { reason: 'intentional_close' });
                }
            }
        });

        // -- Credential update (save to MongoDB) --
        this.sock.ev.on('creds.update', async () => {
            this._touchEvent();
            try { await this._saveCreds(); } catch (err) {
                log('ERROR', `Failed to save creds for bot ${this.botId}: ${err.message}`);
            }
        });

        // -- Outgoing/echoed message updates: refresh getMessage cache so
        // late-arriving retry receipts still find the ciphertext.
        this.sock.ev.on('messages.update', (updates) => {
            this._touchEvent();
            if (!Array.isArray(updates)) return;
            for (const u of updates) {
                if (u?.key?.fromMe && u?.update?.message) {
                    this._cacheSent(u.key, u.update.message);
                }
            }
        });

        // -- Incoming messages --
        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            this._touchEvent();
            if (type !== 'notify') return;

            for (const msg of messages) {
                // Cache OUTGOING ciphertext so Baileys can answer peer retry
                // receipts later. Must run before the `fromMe` skip below.
                if (msg.key?.fromMe && msg.message) {
                    this._cacheSent(msg.key, msg.message);
                }

                // Surface decrypt failures (CIPHERTEXT stub fires when Baileys
                // gives up on this message). Fires auto session-purge after
                // threshold — see _recordDecryptFailure.
                if (msg.messageStubType === CIPHERTEXT_STUB && !msg.key?.fromMe) {
                    this._recordDecryptFailure(
                        msg.key?.remoteJid,
                        msg.key?.id,
                        msg.key?.participant
                    ).catch(() => {});
                    continue;
                }

                // Skip if from self
                if (msg.key.fromMe) continue;

                // Skip status/broadcast
                if (msg.key.remoteJid === 'status@broadcast') continue;

                // Fire webhook for incoming message (non-blocking)
                const msgBody = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || msg.message?.buttonsResponseMessage?.selectedButtonId
                    || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId
                    || '';
                const msgType = msg.message ? Object.keys(msg.message).find(k => k !== 'messageContextInfo') || 'unknown' : 'unknown';
                this._emit('message_received', {
                    message_id: msg.key.id,
                    from: msg.key.remoteJid,
                    push_name: msg.pushName || null,
                    message_timestamp: msg.messageTimestamp
                        ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
                        : null,
                    message_type: msgType,
                    message_body: msgBody,
                    raw_message: msg.message || null
                });

                try {
                    if (this.onMessage) {
                        await this.onMessage(this.sock, msg, this.botId);
                    }
                } catch (err) {
                    log('ERROR', `Error handling message for bot ${this.botId}: ${err.message}`);
                }
            }
        });

        // -- Group participant join/leave (welcome / goodbye) --
        // groupGreetingService.handleParticipantUpdate invalidates the cache
        // internally before fetching fresh meta. Keep that as the single
        // invalidation point so we don't double-fetch.
        this.sock.ev.on('group-participants.update', async (update) => {
            try {
                await groupGreetingService.handleParticipantUpdate(this.sock, update);
            } catch (err) {
                log('ERROR', `[group-participants] bot ${this.botId}: ${err.message}`);
            }
        });

        // -- Group metadata cache invalidation --
        // groups.update fires when subject/desc/settings change. Drop the
        // cache entry so the next reader sees the new state.
        this.sock.ev.on('groups.update', (updates) => {
            if (!Array.isArray(updates)) return;
            for (const u of updates) {
                if (u?.id) invalidateGroupMetadata(this.sock, u.id);
            }
        });

        // groups.upsert delivers full metadata payloads for groups the user
        // has just joined or fetched. Seed the cache so the first command
        // doesn't pay a cold-fetch round-trip.
        this.sock.ev.on('groups.upsert', (metas) => {
            if (!Array.isArray(metas)) return;
            for (const m of metas) {
                if (m?.id) setCachedGroupMetadata(this.sock, m.id, m);
            }
        });

        // Forward every Baileys event to the integrator's webhook (subject to
        // their subscription filter). The high-level lifecycle/message events
        // above continue to fire under their custom names so existing
        // integrations don't break.
        this.sock.ev.process(async (events) => {
            if (!this._webhookConfig) return;
            for (const [eventName, payload] of Object.entries(events)) {
                if (RAW_FORWARD_BLACKLIST.has(eventName)) continue;
                this._emit(eventName, payload);
            }
        });
    }

    // ── Presence simulation ──────────────────────────────────────────────────
    // Periodically toggles online/offline so the account doesn't look like
    // an always-on bot. Runs every 3-8 minutes; 25 % chance to go offline
    // for 30 s – 2 min before coming back online.

    _startPresenceSimulation() {
        this._stopPresenceSimulation(); // clear any previous interval

        const tick = async () => {
            if (!this.sock || !this.isRunning) return;

            try {
                if (Math.random() < 0.25) {
                    // Go offline briefly
                    await this.sock.sendPresenceUpdate('unavailable');
                    const offlineMs = randomInt(30_000, 120_000);
                    setTimeout(async () => {
                        if (this.sock && this.isRunning) {
                            await this.sock.sendPresenceUpdate('available').catch(() => {});
                        }
                    }, offlineMs);
                }
            } catch {
                // Presence updates are best-effort
            }
        };

        // Random interval between 3-8 minutes
        const intervalMs = randomInt(180_000, 480_000);
        this._presenceInterval = setInterval(tick, intervalMs);
        if (typeof this._presenceInterval.unref === 'function') {
            this._presenceInterval.unref();
        }
    }

    _stopPresenceSimulation() {
        if (this._presenceInterval) {
            clearInterval(this._presenceInterval);
            this._presenceInterval = null;
        }
    }

    /**
     * Stop the WhatsApp connection gracefully.
     */
    async stop() {
        try {
            this._intentionalClose = true;
            this._stopPresenceSimulation();
            this._stopWatchdog();
            if (this.sock) {
                await this.sock.logout().catch(() => {});
                this.sock.end(undefined);
                this.sock = null;
            }
            this.isRunning = false;
            log('INFO', `Bot stopped: ${this.botId} (${this.phoneNumber})`);
        } catch (error) {
            log('ERROR', `Failed to stop bot ${this.botId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Force QR pairing flow. Closes socket without logout (preserves creds),
     * then re-starts in QR mode so Baileys emits fresh QR via connection.update.
     * If creds are still valid, Baileys reconnects silently — caller should
     * listen for both `qr_generated` and `bot_connected` events.
     */
    async switchToQrMode() {
        this._autoRequestPairing = false;
        this._pairingCodeRequested = false;

        try {
            await this.disconnect();
        } catch (e) {
            // socket may already be closed — ignore
        }

        await this.start({ pairingCode: false });
    }

    /**
     * Disconnect without logging out (preserves session for reconnect).
     */
    async disconnect() {
        try {
            this._intentionalClose = true;
            this._stopPresenceSimulation();
            this._stopWatchdog();
            if (this.sock) {
                this.sock.end(undefined);
                this.sock = null;
            }
            this.isRunning = false;
            this._setState('disconnected');
            log('INFO', `Bot disconnected (session preserved): ${this.botId}`);
        } catch (error) {
            log('ERROR', `Failed to disconnect bot ${this.botId}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = WaConnection;
