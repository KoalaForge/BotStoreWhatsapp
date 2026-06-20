'use strict';

/**
 * sendGuarded — the single hardened send path for ALL outgoing messages
 * (DM and group). Extracted from WaCtx._sendWithRetry so that callers which
 * only hold a raw `sock` (group ack helpers, delivery service) get the SAME
 * resilience as ctx.reply():
 *
 *   - WS readiness wait        (don't fire into a reconnecting socket)
 *   - open settle grace        (~2s after `connection: open` before first send)
 *   - session-storm gate       (group sends wait out the libsignal re-key churn)
 *   - watchdog touch           (a long USync fanout counts as activity)
 *   - transient-error retry     (428 / 408 / Timed Out / No session)
 *
 * Big-group stability was never limited by member count — the socket already
 * caches group metadata + device lists. It was limited by group-ack sends
 * bypassing this guard and firing raw `sock.sendMessage` into the storm with
 * no retry. Routing every send through here closes that gap.
 *
 * @param {Object} sock - Baileys WASocket
 * @param {string} jid - Target JID (`...@g.us`, `...@s.whatsapp.net`, `...@lid`)
 * @param {Object} content - Baileys message content
 * @param {Object} [options={}] - 3rd-arg sendMessage options (e.g. { quoted })
 * @param {Object} [opts={}]
 * @param {number} [opts.maxRetries=1] - extra attempts after the first (1 → 2 total)
 * @param {Object} [opts.debugKey=null] - rawMessage.key for [SENDDBG] @lid tracing
 * @returns {Promise<Object>} Baileys sendMessage result
 */
async function sendGuarded(sock, jid, content, options = {}, opts = {}) {
    const maxRetries = opts.maxRetries != null ? opts.maxRetries : 1;
    const debugKey = opts.debugKey || null;

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // Pre-flight readiness check: if the socket isn't OPEN, wait a bit for
        // reconnect before throwing. sock.ws is Baileys' WebSocketClient wrapper
        // — its open state is the `isOpen` getter, NOT `readyState` (undefined
        // on the wrapper).
        const ws = sock?.ws;
        if (!sock || (ws && !ws.isOpen)) {
            await new Promise(r => setTimeout(r, 1500));
        }
        // Keep the watchdog quiet: an outgoing send in progress counts as
        // activity. Without this, a long send to a 1000-member group (USync +
        // fanout encrypt) can stretch past the watchdog idle threshold and trip
        // a false WS restart mid-send.
        sock?._touchEvent?.();
        // Settle grace: server-side device slot needs ~2s to finish registering
        // after `connection: 'open'`. Sending earlier can hit 428 "Connection
        // Closed" mid-flight. WaConnection stamps `sock._openedAt` on every open.
        const openedAt = sock?._openedAt;
        if (openedAt && Date.now() - openedAt < 2000) {
            const wait = 2000 - (Date.now() - openedAt);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
        }
        // Session-storm gate: when a burst of decrypt failures fires (peers with
        // desynced ratchets after a reconnect), libsignal is busy recreating
        // sessions and the event loop is CPU-saturated. Sending mid-storm draws
        // 428 — wait for the flag to expire. GROUP sends only: storm is
        // many-peers libsignal churn, so DM sends to a single peer proceed.
        const isGroupSend = typeof jid === 'string' && jid.endsWith('@g.us');
        const stormUntil = sock?._sessionStormUntil;
        if (stormUntil && Date.now() < stormUntil && isGroupSend) {
            const wait = Math.min(stormUntil - Date.now(), 8000);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
        }
        try {
            const _res = await sock.sendMessage(jid, content, options);
            // [SENDDBG] temporary instrumentation — confirms send resolved and
            // to which JID. Remove once the @lid DM issue is root-caused.
            try {
                const k = debugKey || {};
                console.log('[ SENDDBG ] send OK', {
                    jid,
                    attempt,
                    msgId: _res?.key?.id || null,
                    remoteJid: k.remoteJid || null,
                    senderPn: k.senderPn || null,
                    participantPn: k.participantPn || null
                });
            } catch {}
            return _res;
        } catch (err) {
            lastErr = err;
            const errMsg = err?.message || '';
            const code = err?.output?.statusCode;
            // [SENDDBG] temporary instrumentation — exact failure at the choke
            // point. Remove once root-caused.
            try {
                const k = debugKey || {};
                console.log('[ SENDDBG ] send FAIL', {
                    jid,
                    attempt,
                    err: errMsg,
                    code: code ?? null,
                    name: err?.name || null,
                    remoteJid: k.remoteJid || null,
                    senderPn: k.senderPn || null
                });
            } catch {}
            const transient = errMsg.includes('Connection Closed')
                || errMsg.includes('Timed Out')
                // libsignal SessionError thrown when no pairwise session exists
                // for the target (peer re-keyed, or session gap after a
                // volume-less restart). sock.sendMessage runs assertSessions
                // which fetches a fresh prekey bundle, so a single backoff retry
                // usually succeeds. 'No session' also covers 'No sessions'.
                || errMsg.includes('No session')
                || errMsg.includes('No open session')
                || code === 408
                || code === 428
                || code === 500
                || code === 503;
            if (!transient || attempt === maxRetries) throw err;
            // Backoff: 1.5s, 3.5s. Server-side device-slot re-registration after
            // a 408 typically clears in ~2-3s.
            await new Promise(r => setTimeout(r, 1500 + attempt * 2000));
        }
    }
    throw lastErr;
}

module.exports = { sendGuarded };
