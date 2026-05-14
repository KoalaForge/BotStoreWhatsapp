const crypto = require('crypto');
const { BadRequestException } = require('../../exceptions');
const webhookDeliveryLogModel = require('../../database/models/webhookDeliveryLogModels');
const userWhatsappBotModel = require('../../database/models/userWhatsappBotModels');
const { useMongoAuthState } = require('../../whatsapp/mongoAuthState');

const SINGLE_USER_ID = 'owner-single';

/**
 * SINGLE mode bot routes — mounted at /api/bots so SINGLE and MULTI share
 * the same client surface. SINGLE has exactly one connection; these handlers
 * ignore the :id path param and always operate on that lone WaConnection.
 *
 * Mounted endpoints:
 *   POST   /api/bots/create              - Bootstrap pairing + (optionally) attach webhook
 *   GET    /api/bots                     - List (always 1 entry)
 *   GET    /api/bots/:id                 - Return single connection details (id ignored)
 *   PATCH  /api/bots/:id                 - Update webhook_url / webhook_events / webhook_secret
 *   POST   /api/bots/:id/pairing-code    - Issue pairing code for single connection
 *   POST   /api/bots/:id/deactivate      - Disconnect single connection
 *   POST   /api/bots/:id/reactivate      - Reconnect single connection
 *   DELETE /api/bots/:id                 - Disconnect + clear auth state + reset (full teardown)
 *   GET    /api/bots/:id/webhook-logs    - Webhook delivery audit log (filter, paginate)
 *
 * Body fields accepted by /create + PATCH:
 *   phone_number       string  (digits only after sanitization; 8–15 long)
 *   pairing_method     'qr' | 'code'  (default 'qr')
 *   webhook_url        string | null  (null to clear)
 *   webhook_events     string[]       (default ['*'])
 *   webhook_secret     string         (auto-generated if omitted with new webhook_url)
 *
 * @param {FastifyInstance} fastify
 * @param {Object} options
 * @param {Object} options.connection - The single WaConnection instance
 */
async function singleRoutes(fastify, options) {
    const connection = options.connection;
    const SINGLE_BOT_ID = 'single';

    const serializeBot = async () => {
        const doc = await userWhatsappBotModel.findOne({ userId: SINGLE_USER_ID }).lean();
        return {
            bot_id: SINGLE_BOT_ID,
            phone_number: connection.phoneNumber,
            is_running: connection.isRunning,
            is_active: doc?.isActive ?? true,
            is_suspended: doc?.isSuspended ?? false,
            started_at: connection.startedAt || null,
            connection_state: doc?.connection_state || connection.getState(),
            last_state_change_at: doc?.last_state_change_at || null,
            last_connected_at: doc?.lastConnectedAt || null,
            browser_profile: doc?.browser_profile || null,
            webhook_url: connection._webhookConfig?.url || doc?.webhook_url || null,
            webhook_events: connection._webhookConfig?.events || doc?.webhook_events || null
        };
    };

    /** Upsert the persistent user_whatsapp_bots record for SINGLE mode. */
    const upsertBotDoc = async (patch) => {
        const existing = await userWhatsappBotModel.findOne({ userId: SINGLE_USER_ID });
        if (!existing) {
            // Cannot create record without phoneNumber (unique + required).
            if (!patch.phoneNumber) return null;
            const doc = new userWhatsappBotModel({
                userId: SINGLE_USER_ID,
                phoneNumber: patch.phoneNumber,
                pairingMethod: patch.pairingMethod || null,
                isActive: true,
                isSuspended: false,
                webhook_url: patch.webhook_url ?? null,
                webhook_events: patch.webhook_events ?? ['*'],
                webhook_secret: patch.webhook_secret ?? null
            });
            await doc.save();
            return doc;
        }
        Object.keys(patch).forEach(k => { existing[k] = patch[k]; });
        await existing.save();
        return existing;
    };

    /**
     * Apply webhook config from a request body to both the in-memory
     * WaConnection and the persistent userWhatsappBot record. Returns the
     * applied config (or null if no webhook fields were present in body).
     */
    const applyWebhookConfig = async (body) => {
        if (!('webhook_url' in body) && !('webhook_events' in body) && !('webhook_secret' in body)) {
            return null;
        }
        if (body.webhook_url === null || body.webhook_url === '') {
            connection.setWebhookConfig(null);
            await upsertBotDoc({
                webhook_url: null,
                webhook_events: null,
                webhook_secret: null
            });
            return { url: null, events: null, secret: null };
        }
        if (!body.webhook_url) {
            return null;
        }
        const events = Array.isArray(body.webhook_events) && body.webhook_events.length
            ? body.webhook_events
            : ['*'];
        const secret = body.webhook_secret || crypto.randomBytes(32).toString('hex');
        connection.setWebhookConfig({ url: body.webhook_url, events, secret });
        await upsertBotDoc({
            webhook_url: body.webhook_url,
            webhook_events: events,
            webhook_secret: secret
        });
        return { url: body.webhook_url, events, secret };
    };

    fastify.post('/create', async (request, reply) => {
        // SINGLE: one connection only. /create is idempotent — accepts
        // phone_number to bootstrap the pairing-code flow (QR flow doesn't
        // need it) and returns the current pairing surface.
        const body = request.body || {};
        const pairing_method = body.pairing_method || 'qr';

        if (body.phone_number) {
            const clean = String(body.phone_number).replace(/[^0-9]/g, '');
            if (!clean || clean.length < 8 || clean.length > 15) {
                throw new BadRequestException('phone_number must be 8–15 digits in international format (no +)');
            }
            connection.phoneNumber = clean;
            await upsertBotDoc({ phoneNumber: clean, pairingMethod: pairing_method });
        }

        if (pairing_method === 'code' && !connection.phoneNumber) {
            throw new BadRequestException('pairing_method=code requires phone_number in request body');
        }

        const webhookApplied = await applyWebhookConfig(body);

        const data = {
            ...(await serializeBot()),
            pairing_method,
            qr_ws_url: `/ws/qr/${SINGLE_BOT_ID}`
        };

        if (webhookApplied?.secret) {
            // Returned only on creation/rotation. Integrator must store it now.
            data.webhook_secret = webhookApplied.secret;
        }

        if (pairing_method === 'code' && !connection.isRunning) {
            // Attach pairingCode listener BEFORE start() to avoid the race
            // where the auto-fire from 'connecting' resolves before we await.
            const codePromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('Pairing code timeout after 20s'));
                }, 20_000);
                const onCode = (c) => { cleanup(); resolve(c); };
                const onErr = (e) => { cleanup(); reject(e); };
                const cleanup = () => {
                    clearTimeout(timer);
                    connection.removeListener('pairingCode', onCode);
                    connection.removeListener('pairingError', onErr);
                };
                connection.once('pairingCode', onCode);
                connection.once('pairingError', onErr);
            });

            try {
                if (connection.sock) {
                    await connection.disconnect();
                }
                await connection.start({ pairingCode: true });
                const code = await codePromise;
                data.pairing_code = code;
                data.pairing_code_formatted = code.length === 8
                    ? `${code.slice(0, 4)}-${code.slice(4)}`
                    : code;
            } catch (err) {
                data.pairing_code = null;
                data.pairing_note = `Pairing code generation failed: ${err.message}`;
            }
        } else if (pairing_method === 'qr' && !connection.isRunning && !connection.sock) {
            // QR flow: bring socket up without pairing-code option. WebSocket
            // /ws/qr/:botId clients receive QR frames; webhook 'qr_generated'
            // fires for each. If creds already exist, this reconnects silently.
            connection.start().catch(() => { /* errors surface via events */ });
        }

        reply.code(200);
        return {
            success: true,
            code: 200,
            message: connection.isRunning
                ? 'Single connection already paired and running.'
                : 'Single connection ready for pairing.',
            data
        };
    });

    fastify.get('/', async () => ({
        success: true,
        code: 200,
        message: 'OK',
        data: {
            bots: [await serializeBot()],
            total: 1,
            page: 1,
            limit: 1
        }
    }));

    fastify.get('/:id', async () => ({
        success: true,
        code: 200,
        message: 'OK',
        data: await serializeBot()
    }));

    fastify.patch('/:id', async (request) => {
        const body = request.body || {};
        const webhookApplied = await applyWebhookConfig(body);

        const data = await serializeBot();
        if (webhookApplied?.secret) {
            data.webhook_secret = webhookApplied.secret;
        }
        return {
            success: true,
            code: 200,
            message: 'Updated',
            data
        };
    });

    fastify.post('/:id/pairing-code', async () => {
        if (connection.isRunning) {
            throw new BadRequestException('Bot is already connected. No pairing needed.');
        }
        if (!connection.phoneNumber) {
            throw new BadRequestException('phone_number not set — call POST /api/bots/create with phone_number first');
        }
        const code = await connection.requestPairingCode();
        return {
            success: true,
            code: 200,
            message: 'Pairing code generated',
            data: {
                bot_id: SINGLE_BOT_ID,
                pairing_code: code,
                pairing_code_formatted: code.length === 8
                    ? `${code.slice(0, 4)}-${code.slice(4)}`
                    : code,
                phone_number: connection.phoneNumber
            }
        };
    });

    fastify.post('/:id/qr', async (request, reply) => {
        if (connection.isRunning) {
            throw new BadRequestException('Bot is already connected. No QR needed.');
        }

        connection.switchToQrMode().catch((e) => {
            console.error(`switchToQrMode failed for ${SINGLE_BOT_ID}:`, e && e.message ? e.message : e);
        });

        return reply.code(202).send({
            success: true,
            code: 202,
            message: 'QR generation initiated. Watch webhook qr_generated or /ws/qr/:botId.',
            data: {
                bot_id: SINGLE_BOT_ID,
                qr_ws_url: `/ws/qr/${SINGLE_BOT_ID}`,
                phone_number: connection.phoneNumber
            }
        });
    });

    fastify.post('/:id/deactivate', async () => {
        await connection.disconnect();
        return {
            success: true,
            code: 200,
            message: 'Single connection disconnected. Call /reactivate to reconnect.',
            data: await serializeBot()
        };
    });

    fastify.post('/:id/reactivate', async () => {
        if (connection.isRunning) {
            return {
                success: true,
                code: 200,
                message: 'Already running.',
                data: await serializeBot()
            };
        }
        // Don't await — start() resolves once the socket is open. Caller
        // polls /:id or watches /ws/qr/:botId for state.
        connection.start().catch(() => { /* errors surface via events */ });
        return {
            success: true,
            code: 202,
            message: 'Reconnect initiated. Watch /ws/qr/:botId or poll /:id for state.',
            data: await serializeBot()
        };
    });

    fastify.post('/:id/restart', async (request, reply) => {
        // Stop existing socket if running, then start fresh with stored auth.
        if (connection.sock || connection.isRunning) {
            await connection.disconnect();
        }
        connection.start().catch(() => { /* errors surface via events */ });
        return reply.code(202).send({
            success: true,
            code: 202,
            message: 'Restart initiated. Watch /ws/qr/:botId or poll /:id for state.',
            data: {
                bot_id: SINGLE_BOT_ID,
                state: 'restarting'
            }
        });
    });

    fastify.delete('/:id', async () => {
        // Clear webhook config FIRST so disconnect() doesn't emit a doomed
        // bot_disconnected event after the integrator deleted the bot.
        connection.setWebhookConfig(null);

        // Order: disconnect → clear auth state → delete persistent record →
        // reset in-memory state. Matches MULTI's WaBotManager.deleteBot.
        if (connection.sock || connection.isRunning) {
            await connection.disconnect();
        }
        try {
            const { clearAll } = await useMongoAuthState(connection.botId);
            await clearAll();
        } catch (_) { /* best-effort */ }
        await userWhatsappBotModel.deleteOne({ userId: SINGLE_USER_ID });

        connection.phoneNumber = null;
        connection.isRunning = false;
        connection.startedAt = null;
        connection._authState = null;
        connection._saveCreds = null;
        connection._clearAuth = null;
        connection._pairingCodeRequested = false;
        connection._autoRequestPairing = false;
        connection._intentionalClose = true;
        connection._reconnectAttempts = 0;
        connection.sock = null;

        return {
            success: true,
            code: 200,
            message: 'Single connection deleted (auth + record cleared). POST /api/bots/create to set up again.',
            data: null
        };
    });

    fastify.get('/:id/webhook-logs', async (request) => {
        const { status, event, page = 1, limit = 20 } = request.query || {};
        const filter = { bot_id: SINGLE_BOT_ID };
        if (status) filter.status = status;
        if (event) filter.event = event;

        const pageNum = parseInt(page) || 1;
        const limitNum = Math.min(parseInt(limit) || 20, 100);
        const skip = (pageNum - 1) * limitNum;

        const [logs, total] = await Promise.all([
            webhookDeliveryLogModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            webhookDeliveryLogModel.countDocuments(filter)
        ]);

        return {
            success: true,
            code: 200,
            message: 'Webhook delivery logs retrieved successfully',
            data: {
                logs: logs.map(l => ({
                    id: l._id.toString(),
                    envelope_id: l.envelope_id,
                    event: l.event,
                    url: l.url,
                    status: l.status,
                    attempts: l.attempts,
                    response_code: l.response_code,
                    response_body: l.response_body,
                    last_attempt_at: l.last_attempt_at,
                    created_at: l.createdAt,
                    payload: l.payload
                })),
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    total_pages: Math.ceil(total / limitNum)
                }
            }
        };
    });
}

module.exports = singleRoutes;
