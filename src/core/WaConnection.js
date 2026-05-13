const { Boom } = require('@hapi/boom');
const clc = require('cli-color');
const moment = require('moment-timezone');
const pino = require('pino');
const { useMongoAuthState } = require('../whatsapp/mongoAuthState');
const { loadBaileys } = require('../whatsapp/baileysLoader');
const { EventEmitter } = require('events');
const { sendWebhook } = require('../services/webhookNotificationService');
const { humanDelay, jitteredDelay, randomInt } = require('../utils/humanDelay');
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
        this._maxReconnectAttempts = 5;   // Reduced from 10 — less aggressive
        this._intentionalClose = false;
        this._presenceInterval = null;
        // Circuit breaker for 408/connectionLost after a successful `open`.
        // Healthy sessions never hit this — 408 takes ~30s of dead keepalive
        // to fire, so 3× in 2 min is structurally impossible without a deeper
        // problem. When tripped, escalate to the generic exp-backoff path so
        // we eventually surface `maxReconnectFailed` to the manager instead of
        // looping silently.
        this._timeoutWindow = [];
        this._timeoutWindowMs = 120_000;
        this._timeoutWindowMax = 3;
        this._lastOpenAt = 0;
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
        const { state, saveCreds, clearAll } = await useMongoAuthState(this.botId);
        this._authState = state;
        this._saveCreds = saveCreds;
        this._clearAuth = clearAll;

        this._intentionalClose = false;
        this._reconnectAttempts = 0;
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
        const { DisconnectReason, fetchLatestBaileysVersion } = baileys;
        // Stash for use in connection.update handler below.
        this._DisconnectReason = DisconnectReason;

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

        this.sock = makeWASocket({
            version,
            auth: this._authState,
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
            defaultQueryTimeoutMs: 60_000,
            retryRequestDelayMs: 2_000,
            // v7 requires getMessage for retry + poll-vote decrypt. Minimal stub —
            // returns undefined which signals "no cached message"; baileys handles fallback.
            getMessage: async (_key) => undefined,
        });

        // -- Connection update events --
        this.sock.ev.on('connection.update', async (update) => {
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
                this._lastOpenAt = Date.now();
                this._timeoutWindow = [];
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
            }

            if (connection === 'close') {
                this.isRunning = false;
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
                        if (this._reconnectAttempts <= this._maxReconnectAttempts) {
                            const base = Math.min(2000 * Math.pow(2, this._reconnectAttempts - 1), 120000);
                            const delay = Math.round(base * (0.7 + Math.random() * 0.6));
                            log('WARN', `Bot ${this.botId} disconnected (code ${statusCode}). Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);
                            setTimeout(() => this._connect(options), delay);
                        } else {
                            log('ERROR', `Bot ${this.botId} exceeded max reconnect attempts (${this._maxReconnectAttempts}). Giving up.`);
                            this._setState('failed');
                            this.emit('maxReconnectFailed');
                            this._emit('bot_disconnected', {
                                reason: 'max_reconnect_attempts_exceeded',
                                status_code: statusCode
                            });
                        }
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
                    await this._clearAuth();
                    this._setState('logged_out');
                    this.emit('loggedOut');
                    this._emit('bot_logged_out', { status_code: statusCode });
                } else if (shouldReconnect && !this._intentionalClose) {
                    this._reconnectAttempts++;
                    if (this._reconnectAttempts <= this._maxReconnectAttempts) {
                        // Exponential backoff capped at 2 min, with ±30 % jitter
                        const base = Math.min(2000 * Math.pow(2, this._reconnectAttempts - 1), 120000);
                        const delay = Math.round(base * (0.7 + Math.random() * 0.6));
                        log('WARN', `Bot ${this.botId} disconnected (code ${statusCode}). Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);
                        this._setState('reconnecting');
                        setTimeout(() => this._connect(options), delay);
                    } else {
                        log('ERROR', `Bot ${this.botId} exceeded max reconnect attempts (${this._maxReconnectAttempts}). Giving up.`);
                        this._setState('failed');
                        this.emit('maxReconnectFailed');
                        this._emit('bot_disconnected', {
                            reason: 'max_reconnect_attempts_exceeded',
                            status_code: statusCode
                        });
                    }
                } else {
                    log('INFO', `Bot ${this.botId} connection closed intentionally.`);
                    this._setState('disconnected');
                    this._emit('bot_disconnected', { reason: 'intentional_close' });
                }
            }
        });

        // -- Credential update (save to MongoDB) --
        this.sock.ev.on('creds.update', this._saveCreds);

        // -- Incoming messages --
        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                // Skip if from self
                if (msg.key.fromMe) continue;

                // Skip group messages (DM only)
                if (msg.key.remoteJid.endsWith('@g.us')) continue;

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
     * Disconnect without logging out (preserves session for reconnect).
     */
    async disconnect() {
        try {
            this._intentionalClose = true;
            this._stopPresenceSimulation();
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
