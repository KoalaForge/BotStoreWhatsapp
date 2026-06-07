const clc = require('cli-color');
const { humanDelay, typingDelay, backoffDelay, isHumanizeDisabled } = require('../utils/humanDelay');
const { canSendOutgoing, recordOutgoing } = require('../utils/outgoingRateLimiter');

/**
 * WaCtx - WhatsApp Context Wrapper
 *
 * Provides a consistent interface for message handlers, mirroring
 * common Telegraf ctx patterns but adapted for Baileys/WhatsApp.
 *
 * Key differences from Telegraf ctx:
 * - No message editing (WhatsApp doesn't support it)
 * - No answerCbQuery (handled via message response)
 * - Buttons limited to 3 interactive buttons or list messages
 * - User ID is WhatsApp JID (phone@s.whatsapp.net) not numeric
 */
class WaCtx {
    /**
     * @param {Object} sock - Baileys WASocket instance
     * @param {Object} msg - Baileys message object
     * @param {string} botId - MongoDB bot ID (null for SINGLE mode)
     */
    constructor(sock, msg, botId = null) {
        this.sock = sock;
        this._rawMessage = msg;
        this._botId = botId;

        // Extract message content
        const messageContent = msg.message || {};
        this._messageType = Object.keys(messageContent).find(k =>
            !['messageContextInfo', 'senderKeyDistributionMessage'].includes(k)
        ) || null;

        // State (injected by middleware)
        this.state = { botId };
        this.repositoryContext = null;
        this.pricingService = null;
        this.session = {};

        // Match data (populated by router for regex patterns)
        this.match = null;

        // Callback data (from button responses)
        this.callbackData = null;

        // Chat/jid override — set by cloneToDM() so group-originated flows can
        // target the user's DM JID while preserving the original message.
        this._chatOverride = null;
        this._originGroupJid = null;
    }

    // ==========================================
    // Identity Properties
    // ==========================================

    /**
     * Full JID of the sender (for mentions, sendTo).
     * - DM: same as remoteJid.
     * - Group: key.participant is the sender JID (preferring participantAlt
     *   when participant is `@lid`).
     * - Cloned-to-DM ctx: returns the override DM JID.
     */
    get jid() {
        if (this._chatOverride) return this._chatOverride;
        const key = this._rawMessage.key || {};
        const remote = key.remoteJid || '';
        if (remote.endsWith('@g.us')) {
            const part = key.participant || '';
            if (part.endsWith('@lid') && key.participantAlt) {
                return String(key.participantAlt);
            }
            return part || remote;
        }
        return remote;
    }

    /**
     * User identifier — phone-only when resolvable, no @suffix.
     * v7+ baileys: when remoteJid is `xxx@lid`, baileys populates `remoteJidAlt`
     * with the phone JID (`628xxx@s.whatsapp.net`). Prefer the phone form so
     * downstream WHITELIST_ID/admin lookups resolve identity-stable.
     */
    get from() {
        const key = this._rawMessage.key || {};
        const remote = key.remoteJid || '';

        // Group: sender is in `participant`. Prefer participantAlt (v7+) or
        // participantPn (v6.7) when participant is @lid to resolve phone JID.
        if (remote.endsWith('@g.us')) {
            const part = key.participant || '';
            if (part.endsWith('@lid')) {
                if (key.participantAlt) return String(key.participantAlt).split('@')[0].split(':')[0];
                if (key.participantPn)  return String(key.participantPn).split('@')[0].split(':')[0];
            }
            return part.split('@')[0].split(':')[0];
        }

        if (remote.endsWith('@lid')) {
            if (key.remoteJidAlt) return String(key.remoteJidAlt).split('@')[0].split(':')[0];
            if (key.senderPn)     return String(key.senderPn).split('@')[0].split(':')[0];
        }
        return remote.split('@')[0].split(':')[0];
    }

    /** Chat JID — full JID needed by sock.sendMessage() */
    get chat() {
        if (this._chatOverride) return this._chatOverride;
        // Reply on the SAME JID the message arrived on (group @g.us, DM @lid
        // or PN). Baileys keyed the signal session to this exact address; do
        // NOT rewrite DM `@lid`→PN here — that targets a different/empty
        // session, so the send resolves but never delivers ("typing forever,
        // no reply"). Identity resolution (DB lookups) lives in `from`, which
        // still maps @lid→PN. See revert f289028: the @lid→PN reply rewrite
        // made bots respond once then go silent in DM while groups kept working.
        return this._rawMessage.key?.remoteJid || '';
    }

    /**
     * True when the *active chat* is a group. For ctx instances produced by
     * `cloneToDM()` this is false — even though the original message came from
     * a group, sends now target the user's DM. Use `originGroupJid` to detect
     * the "was cloned from group" case.
     */
    get isGroup() {
        if (this._chatOverride) return false;
        const remote = this._rawMessage?.key?.remoteJid || '';
        return remote.endsWith('@g.us');
    }

    /**
     * Origin group JID when this ctx was cloned from a group message.
     * Returns null for native DM contexts (and for groups that haven't been cloned).
     */
    get originGroupJid() {
        return this._originGroupJid;
    }

    /** Alias for from (phone number without @suffix) */
    get phoneNumber() {
        return this.from;
    }

    /** Sender info object (mimics Telegraf ctx.from) */
    get fromUser() {
        const pushName = this._rawMessage.pushName || '';
        return {
            id: this.from,
            phone: this.from,
            first_name: pushName,
            username: this.from
        };
    }

    // ==========================================
    // Message Content Properties
    // ==========================================

    /** Raw Baileys message object */
    get rawMessage() {
        return this._rawMessage;
    }

    /** Message key (used for deletion, quoting) */
    get messageKey() {
        return this._rawMessage.key;
    }

    /** Message type string */
    get messageType() {
        return this._messageType;
    }

    /** Extracted text content from any message type. Text-only bot — no button responses. */
    get message() {
        const content = this._rawMessage.message || {};

        if (content.conversation) return content.conversation;
        if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
        if (content.imageMessage?.caption) return content.imageMessage.caption;
        if (content.documentMessage?.caption) return content.documentMessage.caption;

        return '';
    }

    /** Always false — bot no longer sends interactive buttons. */
    get isCallback() {
        return false;
    }

    /** Whether this message contains an image */
    get hasImage() {
        return !!this._rawMessage.message?.imageMessage;
    }

    /** Whether this message contains a document */
    get hasDocument() {
        return !!this._rawMessage.message?.documentMessage;
    }

    // ==========================================
    // Send Methods
    // ==========================================

    /**
     * Wrap sock.sendMessage with retry on transient WS errors. Sends to a large
     * group can take several seconds (USync device fanout + per-device encrypt);
     * a 408 / 428 / "Connection Closed" mid-flight is recoverable once the WS
     * reconnects. Without retry, every transient drop loses a user reply.
     *
     * Non-transient errors (auth, forbidden, message-not-found, validation)
     * propagate immediately — retry would just delay the failure.
     *
     * maxRetries=1 (2 attempts total). With defaultQueryTimeoutMs=25s the
     * worst-case wall time is ~55s — well below the 180s pain threshold
     * users were hitting with the old 3-attempt × 60s timeout combo. A
     * second consecutive 1k-group USync failure means the WS has bigger
     * problems; let reconnect + circuit-breaker handle it.
     *
     * @private
     */
    async _sendWithRetry(jid, content, options = {}, maxRetries = 1) {
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // Pre-flight readiness check: if the socket isn't OPEN, wait a
            // bit for reconnect before throwing. ws.readyState === 1 → OPEN.
            const ws = this.sock?.ws;
            if (!this.sock || (ws && ws.readyState !== 1)) {
                await new Promise(r => setTimeout(r, 1500));
            }
            // Keep the watchdog quiet: an outgoing send in progress counts as
            // activity. Without this, a long send to a 1000-member group
            // (USync + fanout encrypt) can stretch past the watchdog idle
            // threshold and trip a false WS restart mid-send.
            this.sock?._touchEvent?.();
            // Settle grace: server-side device slot needs ~2s to finish
            // registering after `connection: 'open'`. Sending earlier can
            // hit 428 "Connection Closed" mid-flight. WaConnection stamps
            // `sock._openedAt` on every open — sleep the remainder. Was 8s
            // historically; that overshoots on healthy networks and stacks
            // with retry × storm gate to cause multi-minute user hangs.
            const openedAt = this.sock?._openedAt;
            if (openedAt && Date.now() - openedAt < 2000) {
                const wait = 2000 - (Date.now() - openedAt);
                if (wait > 0) await new Promise(r => setTimeout(r, wait));
            }
            // Session-storm flag: when a burst of decrypt failures fires
            // (peers with desynced ratchets after a reconnect), libsignal is
            // busy recreating sessions and the event loop is CPU-saturated.
            // Sending mid-storm draws 428 — wait for the flag to expire.
            // GROUP sends only: storm is many-peers libsignal churn, so DM
            // sends to a single peer can proceed without waiting.
            const isGroupSend = typeof jid === 'string' && jid.endsWith('@g.us');
            const stormUntil = this.sock?._sessionStormUntil;
            if (stormUntil && Date.now() < stormUntil && isGroupSend) {
                const wait = Math.min(stormUntil - Date.now(), 8000);
                if (wait > 0) await new Promise(r => setTimeout(r, wait));
            }
            try {
                return await this.sock.sendMessage(jid, content, options);
            } catch (err) {
                lastErr = err;
                const errMsg = err?.message || '';
                const code = err?.output?.statusCode;
                const transient = errMsg.includes('Connection Closed')
                    || errMsg.includes('Timed Out')
                    || code === 408
                    || code === 428
                    || code === 500
                    || code === 503;
                if (!transient || attempt === maxRetries) throw err;
                // Backoff: 1.5s, 3.5s. Server-side device-slot re-registration
                // after a 408 typically clears in ~2-3s.
                await new Promise(r => setTimeout(r, 1500 + attempt * 2000));
            }
        }
        throw lastErr;
    }

    /**
     * Simulate human behavior before sending: typing indicator + natural delay.
     * Skipped when options._skipHumanize is true (e.g. internal/system messages).
     * @param {number} [charCount=0] - Length of outgoing text for proportional delay
     * @param {Object} [options={}]
     * @private
     */
    async _humanize(charCount = 0, options = {}) {
        if (options._skipHumanize) return;

        // Rate limiter — when over limit, brief backoff (env-tunable)
        const check = canSendOutgoing(this.chat);
        if (!check.allowed) {
            await backoffDelay();
        }

        recordOutgoing(this.chat);

        if (isHumanizeDisabled()) return;

        // Skip humanization entirely in groups. typingDelay/humanDelay
        // adds 100-600ms blocking await per reply on the event loop —
        // imperceptible UX cost in a busy 1k-member group but multiplies
        // event-loop CPU pressure during the libsignal encrypt + USync
        // window that causes 428 mid-send. DM keeps the human feel.
        if (this.isGroup) return;

        // Fire-and-forget typing indicator for DM — don't block the reply
        // on presence roundtrips.
        this.sendTyping().catch(() => {});

        if (charCount > 0) {
            await typingDelay(charCount);
        } else {
            await humanDelay();
        }
    }

    /**
     * Reply with text message.
     * Automatically shows typing indicator and human-like delay.
     * @param {string} text - Message text (WhatsApp markdown)
     * @param {Object} [options] - Additional options (_skipHumanize to bypass)
     * @returns {Promise<Object>} Sent message info
     */
    async reply(text, options = {}) {
        await this._humanize(text.length, options);

        let body = text;
        const sendOpts = { ...options };

        // Auto-mention the trigger user in group context. Skip when caller
        // already passed a mentions[] (explicit override) or noMention: true.
        // mentions[] entry + `@<phone>` body token both derived from
        // key.participant so the chip binds in both phone-mode and LID-mode
        // groups. Cloned-DM ctx has isGroup=false (via _chatOverride) so DM
        // flows are unaffected.
        if (this.isGroup && !sendOpts.mentions && !sendOpts.noMention) {
            const key = this._rawMessage?.key || {};
            const senderJid = key.participant || this.jid;
            if (senderJid) {
                const phone = String(senderJid).split('@')[0].split(':')[0];
                body = `@${phone} ${text}`;
                sendOpts.mentions = [senderJid];
            }
        }
        // Auto-quote trigger message in groups so the requesting user gets
        // a push notification for the bot's reply. Explicit `quoted` from
        // caller wins; `noQuote: true` opt-out mirrors `noMention`.
        // Baileys reads `quoted` from the 3rd-arg options of sock.sendMessage,
        // NOT from content — must split it out before spreading sendOpts.
        if (this.isGroup && !sendOpts.quoted && !sendOpts.noQuote) {
            sendOpts.quoted = this._rawMessage;
        }
        delete sendOpts.noMention;
        delete sendOpts.noQuote;
        const { quoted: quotedOpt, ...contentOpts } = sendOpts;
        const sockOpts = quotedOpt ? { quoted: quotedOpt } : {};

        return this._sendWithRetry(this.chat, { text: body, ...contentOpts }, sockOpts);
    }

    /**
     * Reply with action buttons (nativeFlow quick_reply).
     *
     * Uses InteractiveMessage + NativeFlowMessage so buttons render on
     * web/desktop/iOS/Android. Falls back to numbered text if relay fails
     * or the WhatsApp client does not support nativeFlow.
     *
     * Unlike legacy buttonsMessage (hard cap of 3), nativeFlow quick_reply
     * supports more — we still recommend ≤6 for chip-row readability.
     *
     * @param {string} text - Message body
     * @param {Array<{id: string, text: string}>} buttons - Button definitions
     * @param {Object} [options] - footer, title
     * @returns {Promise<Object>}
     */
    async replyWithButtons(text, _buttons, options = {}) {
        return this.reply(text, options);
    }

    /**
     * Reply with a list picker (nativeFlow single_select).
     *
     * Renders as a tap-to-open modal with sections of rows on web/desktop/iOS/Android.
     * Falls back to numbered text on relay failure or unsupported clients.
     *
     * Limits per WhatsApp spec: max 10 sections, max 10 rows per section, row
     * title max 24 chars, description max 72 chars (auto-truncated).
     *
     * @param {string} text - Message body
     * @param {string} buttonText - Label of the list trigger button
     * @param {Array<{title: string, rows: Array<{rowId: string, title: string, description?: string}>}>} sections
     * @param {Object} [options]
     * @param {string} [options.footer] - Footer text
     * @param {string} [options.title] - Header title
     * @param {Array<{id: string, text: string}>} [options.actionButtons] - Optional quick_reply buttons rendered alongside the list (hybrid layout, e.g. pagination/back)
     * @returns {Promise<Object>}
     */
    async replyWithList(text, _buttonText, _sections, options = {}) {
        return this.reply(text, options);
    }

    /**
     * Reply with a multi-section list message.
     * @param {string} text - Message body
     * @param {string} buttonText - Text on the list button
     * @param {Array<{title: string, rows: Array<{rowId: string, title: string, description?: string}>}>} sections
     * @param {Object} [options] - footer, title
     * @returns {Promise<Object>}
     */
    async replyWithSectionList(text, buttonText, sections, options = {}) {
        return this.replyWithList(text, buttonText, sections, options);
    }

    /**
     * Send an image message.
     * @param {Buffer|string} image - Image buffer or URL
     * @param {string} [caption] - Optional caption
     * @param {Object} [options] - Additional options (buttons, etc.)
     * @returns {Promise<Object>}
     */
    async sendImage(image, caption, options = {}) {
        await this._humanize((caption || '').length, options);

        let finalCaption = caption || '';
        const sendOpts = { ...options };

        // Auto-mention in group context — same rule as reply().
        if (this.isGroup && !sendOpts.mentions && !sendOpts.noMention) {
            const key = this._rawMessage?.key || {};
            const senderJid = key.participant || this.jid;
            if (senderJid) {
                const phone = String(senderJid).split('@')[0].split(':')[0];
                finalCaption = finalCaption ? `@${phone} ${finalCaption}` : `@${phone}`;
                sendOpts.mentions = [senderJid];
            }
        }
        // Auto-quote trigger message in groups — same rule as reply().
        // Baileys reads `quoted` from 3rd-arg options, not content; split out.
        if (this.isGroup && !sendOpts.quoted && !sendOpts.noQuote) {
            sendOpts.quoted = this._rawMessage;
        }
        delete sendOpts.noMention;
        delete sendOpts.noQuote;
        const { quoted: quotedOpt, ...contentOpts } = sendOpts;
        const sockOpts = quotedOpt ? { quoted: quotedOpt } : {};

        const content = {
            image: Buffer.isBuffer(image) ? image : { url: image },
            caption: finalCaption,
            ...contentOpts
        };
        return this._sendWithRetry(this.chat, content, sockOpts);
    }

    /**
     * Send a document/file.
     * @param {Buffer} document - File buffer
     * @param {string} fileName - File name with extension
     * @param {string} [caption] - Optional caption
     * @param {string} [mimetype] - MIME type (auto-detected if not provided)
     * @returns {Promise<Object>}
     */
    async sendDocument(document, fileName, caption, mimetype) {
        await this._humanize((caption || '').length);

        return this._sendWithRetry(this.chat, {
            document,
            fileName,
            caption: caption || '',
            mimetype: mimetype || 'application/octet-stream'
        });
    }

    /**
     * Send a message to a specific JID (not the current chat).
     * @param {string} jid - Target JID
     * @param {Object} content - Baileys message content
     * @returns {Promise<Object>}
     */
    async sendTo(jid, content) {
        return this._sendWithRetry(jid, content);
    }

    /**
     * Delete a message.
     * @param {Object} [key] - Message key to delete (defaults to current message)
     * @returns {Promise<Object>}
     */
    async deleteMessage(key) {
        const msgKey = key || this.messageKey;
        return this._sendWithRetry(this.chat, { delete: msgKey });
    }

    /**
     * Mark message as read.
     * @returns {Promise<void>}
     */
    async markRead() {
        await this.sock.readMessages([this.messageKey]);
    }

    /**
     * Send typing indicator.
     * @returns {Promise<void>}
     */
    async sendTyping() {
        await this.sock.presenceSubscribe(this.chat);
        await this.sock.sendPresenceUpdate('composing', this.chat);
    }

    /**
     * Stop typing indicator.
     * @returns {Promise<void>}
     */
    async stopTyping() {
        await this.sock.sendPresenceUpdate('paused', this.chat);
    }

    /**
     * No-op for Telegram compatibility.
     * Telegraf handlers call ctx.answerCbQuery() which has no WhatsApp equivalent.
     */
    async answerCbQuery() {
        // No-op: WhatsApp doesn't have callback query acknowledgement
    }

    /**
     * Clone this context so that send methods target the user's DM JID instead
     * of the current chat. Used by group flows that need to deliver QRIS / order
     * details privately while the trigger arrived in a group.
     *
     * Inherits sock, state, repositoryContext, pricingService, session, match,
     * callbackData from the original. `from`, `messageKey`, `rawMessage`, and
     * `messageType` remain the original sender's. `chat` and `jid` resolve to
     * the user's DM JID.
     */
    cloneToDM() {
        // Resolve the sender's full JID. `this.jid` already handles all cases:
        // DM (remoteJid), group with @s.whatsapp.net participant, and group with
        // @lid participant (preferring participantAlt when WhatsApp exposes it).
        // Using `toJid(this.from)` would strip the @lid suffix and produce a
        // bogus @s.whatsapp.net JID — Baileys then drops the send silently.
        const dmJid = this.jid;
        const clone = new WaCtx(this.sock, this._rawMessage, this._botId);
        clone.state = this.state;
        clone.repositoryContext = this.repositoryContext;
        clone.pricingService = this.pricingService;
        clone.session = { ...this.session };
        clone.match = this.match;
        clone.callbackData = this.callbackData;
        clone._chatOverride = dmJid;
        clone._originGroupJid = this.isGroup ? this._rawMessage.key.remoteJid : null;
        return clone;
    }
}

module.exports = WaCtx;
