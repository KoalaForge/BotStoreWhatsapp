const axios = require('axios');
const crypto = require('crypto');
const clc = require('cli-color');
const PQueue = require('p-queue').default;
const webhookDeliveryLogModel = require('../database/models/webhookDeliveryLogModels');

const httpClient = axios.create({
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' },
    // We construct & sign the body string ourselves; tell axios not to re-stringify.
    transformRequest: [(data) => data]
});

// Per-bot delivery queues. Keeps deliveries for a single bot ordered while
// letting different bots push concurrently.
const queues = new Map();
const QUEUE_CONCURRENCY = 4;
const RETRY_DELAYS_MS = [0, 2_000, 10_000];

// Whitelist of subscribable event names. High-level lifecycle events plus the
// raw Baileys event names from node_modules/baileys/lib/Types/Events.d.ts.
const ALLOWED_EVENTS = [
    '*',
    // High-level lifecycle (server-emitted, not Baileys-native)
    'bot_connected',
    'bot_disconnected',
    'bot_logged_out',
    'message_received',
    'qr_generated',
    'pairing_code_generated',
    'pairing_code_error',
    // Raw Baileys events
    'connection.update',
    'creds.update',
    'messaging-history.set',
    'messaging-history.status',
    'chats.upsert',
    'chats.update',
    'chats.delete',
    'lid-mapping.update',
    'presence.update',
    'contacts.upsert',
    'contacts.update',
    'messages.upsert',
    'messages.update',
    'messages.delete',
    'messages.reaction',
    'messages.media-update',
    'message-receipt.update',
    'groups.upsert',
    'groups.update',
    'group-participants.update',
    'group.join-request',
    'group.member-tag.update',
    'blocklist.set',
    'blocklist.update',
    'call',
    'labels.edit',
    'labels.association',
    'newsletter.reaction',
    'newsletter.view',
    'newsletter-participants.update',
    'newsletter-settings.update',
    'message-capping.update',
    'chats.lock',
    'settings.update'
];

const eventMatches = (event, subs) => {
    if (!Array.isArray(subs) || subs.length === 0) return false;
    return subs.includes('*') || subs.includes(event);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const randomSuffix = () => crypto.randomBytes(6).toString('hex');

const getQueue = (botId) => {
    let q = queues.get(botId);
    if (!q) {
        q = new PQueue({ concurrency: QUEUE_CONCURRENCY });
        queues.set(botId, q);
    }
    return q;
};

/**
 * Replacer used during JSON serialization. Baileys emits Buffers and Longs
 * for some payloads which JSON.stringify renders awkwardly; convert to
 * something integrators can parse.
 */
const replacer = (_key, value) => {
    if (value && typeof value === 'object') {
        if (value.type === 'Buffer' && Array.isArray(value.data)) {
            return Buffer.from(value.data).toString('base64');
        }
        if (typeof value.toString === 'function' && value.constructor && value.constructor.name === 'Long') {
            return value.toString();
        }
    }
    if (typeof value === 'bigint') return value.toString();
    return value;
};

/**
 * Queue a webhook delivery. Fire-and-forget — never throws.
 * @param {Object} config
 * @param {string} config.url
 * @param {string[]} config.events
 * @param {string|null} config.secret
 * @param {string} config.botId
 * @param {string} config.phoneNumber
 * @param {string} eventName
 * @param {*} data
 */
const sendWebhook = (config, eventName, data) => {
    if (!config || !config.url) return;
    if (!eventMatches(eventName, config.events)) return;

    const envelope = {
        id: `evt_${Date.now()}_${randomSuffix()}`,
        event: eventName,
        bot_id: config.botId,
        phone_number: config.phoneNumber,
        timestamp: new Date().toISOString(),
        data
    };

    let body;
    try {
        body = JSON.stringify(envelope, replacer);
    } catch (err) {
        console.log(
            clc.yellow.bold('[ WEBHOOK ]') +
            ` Failed to serialize ${eventName} for bot ${config.botId}: ${err.message}`
        );
        return;
    }

    const signature = config.secret
        ? 'sha256=' + crypto.createHmac('sha256', config.secret).update(body).digest('hex')
        : null;

    const url = config.url;
    const botId = config.botId;

    // Persist log + enqueue delivery. Never let this block the caller.
    queueDelivery(botId, envelope, body, signature, url, eventName).catch(err => {
        console.log(
            clc.red.bold('[ WEBHOOK ]') +
            ` Queue error for bot ${botId} event ${eventName}: ${err.message}`
        );
    });
};

async function queueDelivery(botId, envelope, body, signature, url, eventName) {
    let logDoc;
    try {
        logDoc = await webhookDeliveryLogModel.create({
            envelope_id: envelope.id,
            bot_id: botId,
            event: eventName,
            url,
            payload: envelope,
            status: 'pending',
            attempts: 0
        });
    } catch (err) {
        // If we can't even write the log, still try delivery without audit.
        console.log(
            clc.yellow.bold('[ WEBHOOK ]') +
            ` Failed to persist log for ${eventName}: ${err.message}`
        );
    }

    const queue = getQueue(botId);
    queue.add(() => deliverWithRetry(url, body, signature, logDoc?._id, eventName));
}

async function deliverWithRetry(url, body, signature, logId, eventName) {
    let lastErr = null;
    let lastResponse = null;

    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
        if (RETRY_DELAYS_MS[i] > 0) {
            await sleep(RETRY_DELAYS_MS[i]);
        }
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (signature) headers['X-Webhook-Signature'] = signature;

            const res = await httpClient.post(url, body, { headers });

            if (logId) {
                await webhookDeliveryLogModel.updateOne({ _id: logId }, {
                    status: 'delivered',
                    attempts: i + 1,
                    response_code: res.status,
                    last_attempt_at: new Date()
                }).catch(() => {});
            }
            return;
        } catch (err) {
            lastErr = err;
            lastResponse = err.response || null;
        }
    }

    const responseBody = (() => {
        if (lastResponse?.data !== undefined) {
            try {
                return typeof lastResponse.data === 'string'
                    ? lastResponse.data.slice(0, 1000)
                    : JSON.stringify(lastResponse.data).slice(0, 1000);
            } catch {
                return String(lastResponse.data).slice(0, 1000);
            }
        }
        return (lastErr?.message || 'unknown error').slice(0, 1000);
    })();

    console.log(
        clc.yellow.bold('[ WEBHOOK ]') +
        ` Failed to deliver ${eventName} to ${url} after ${RETRY_DELAYS_MS.length} attempts: ${lastErr?.message}`
    );

    if (logId) {
        await webhookDeliveryLogModel.updateOne({ _id: logId }, {
            status: 'failed',
            attempts: RETRY_DELAYS_MS.length,
            response_code: lastResponse?.status || null,
            response_body: responseBody,
            last_attempt_at: new Date()
        }).catch(() => {});
    }
}

/**
 * Wait for every per-bot delivery queue to finish processing. Used at
 * shutdown so in-flight webhook POSTs (and their audit log writes) don't
 * get cut off. Soft-fails on timeout — caller decides whether to exit.
 * @param {number} timeoutMs
 * @returns {Promise<{drained: boolean, pending: number}>}
 */
async function drainAllQueues(timeoutMs = 15_000) {
    const pendingCount = () =>
        [...queues.values()].reduce((sum, q) => sum + q.size + q.pending, 0);

    if (pendingCount() === 0) return { drained: true, pending: 0 };

    const allIdle = Promise.all([...queues.values()].map(q => q.onIdle()));
    let timedOut = false;
    const timeout = new Promise(resolve => setTimeout(() => {
        timedOut = true;
        resolve();
    }, timeoutMs));

    await Promise.race([allIdle, timeout]);
    return { drained: !timedOut, pending: pendingCount() };
}

module.exports = {
    sendWebhook,
    ALLOWED_EVENTS,
    eventMatches,
    drainAllQueues
};
