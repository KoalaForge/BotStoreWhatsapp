require('dotenv').config();

const clc = require('cli-color');
const moment = require('moment-timezone');
const figlet = require('figlet');

// Configure timezone
moment.tz.setDefault('Asia/Jakarta');

// Core imports
const setupWhatsApp = require('./src/config/waSetup');
const connectDatabase = require('./src/database/connect');
const modeService = require('./src/services/modeService');
const WaCtx = require('./src/whatsapp/WaCtx');
const { humanDelay } = require('./src/utils/humanDelay');

// Display startup banner
console.clear();
console.log(clc.blue(figlet.textSync("KOALA WA!")));

// Validate database connection requirement
if (!process.env.DATABASE_MONGODB_URI) {
    console.error(clc.red.bold("[ ERROR ]") + " DATABASE_MONGODB_URI is required in environment variables");
    process.exit(1);
}

// Validate mode requirements
try {
    modeService.validateModeRequirements();
} catch (error) {
    console.error(clc.red.bold("[ ERROR ]") + ` ${error.message}`);
    process.exit(1);
}

// Main initialization
async function main() {
    try {
        await connectDatabase();

        const mode = modeService.getMode();
        console.log(
            clc.green.bold("[ INFO ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` Running in ${mode} mode`)
        );

        if (modeService.isSingleMode()) {
            await runSingleMode();
        } else {
            await runMultiMode();
        }

        // Signal PM2 that app is ready
        if (process.send) {
            process.send('ready');
        }
    } catch (error) {
        console.error(clc.red.bold("[ ERROR ]") + ` Initialization failed: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

/**
 * Run in SINGLE mode — one WhatsApp number from env
 */
async function runSingleMode() {
    const { useMongoAuthState } = require('./src/whatsapp/mongoAuthState');
    const { EncryptionService } = require('./src/whatsapp/authEncryption');
    const { Boom } = require('@hapi/boom');
    const pino = require('pino');
    const shutdownState = require('./src/services/shutdownState');

    // Initialize auth encryption — required for the on-disk session store.
    EncryptionService.initialize(process.env.WA_AUTH_ENCRYPTION_KEY);

    // Create message router (no botId in SINGLE mode)
    const router = setupWhatsApp(null);

    // Message handler: wraps incoming messages in WaCtx and routes them
    const handleMessage = async (sock, msg, botId) => {
        const ctx = new WaCtx(sock, msg, botId);
        try {
            // Humanize: random delay before reading (humans don't read instantly)
            await humanDelay(400, 1500);
            await ctx.markRead();

            // Small pause after reading before "thinking" and replying
            await humanDelay(200, 800);
            await router.route(ctx);
        } catch (err) {
            console.error(
                clc.red.bold("[ ERROR ]") +
                ` [${moment().format('HH:mm:ss')}]:` +
                clc.red(` Handler error: ${err.message}`)
            );
        }
    };

    // Create WaConnection for SINGLE mode.
    // Restore phone_number + webhook config + browser fingerprint from the
    // persistent user_whatsapp_bots record (written by POST /api/bots/create).
    // Env vars WHATSAPP_PHONE_NUMBER / WEBHOOK_URL act as fallbacks only.
    const WaConnection = require('./src/core/WaConnection');
    const userWhatsappBotModel = require('./src/database/models/userWhatsappBotModels');

    const singleBotDoc = await userWhatsappBotModel.findOne({ userId: 'owner-single' });

    const phoneNumber = singleBotDoc?.phoneNumber || process.env.WHATSAPP_PHONE_NUMBER || null;

    let webhookConfig = null;
    if (singleBotDoc?.webhook_url) {
        webhookConfig = {
            url: singleBotDoc.webhook_url,
            events: singleBotDoc.webhook_events || ['*'],
            secret: singleBotDoc.webhook_secret || null
        };
    } else if (process.env.WEBHOOK_URL) {
        webhookConfig = {
            url: process.env.WEBHOOK_URL,
            events: process.env.WEBHOOK_EVENTS
                ? process.env.WEBHOOK_EVENTS.split(',').map(s => s.trim())
                : ['*'],
            secret: process.env.WEBHOOK_SECRET || null
        };
    }

    const connection = new WaConnection({
        botId: 'single',
        userId: 'owner-single',
        phoneNumber,
        onMessage: handleMessage,
        webhookConfig,
        browserProfile: singleBotDoc?.browser_profile || null
    });

    // Persist connection_state + last_state_change_at on every transition.
    connection.setStatePersister((state) => userWhatsappBotModel.updateOne(
        { userId: 'owner-single' },
        { $set: { connection_state: state, last_state_change_at: new Date() } }
    ));

    connection.on('connected', async () => {
        shutdownState.setReady();
        // Persist lastConnectedAt + browser_profile (first pair only).
        await userWhatsappBotModel.updateOne(
            { userId: 'owner-single' },
            {
                $set: {
                    lastConnectedAt: new Date(),
                    browser_profile: connection.getBrowserProfile()
                }
            }
        ).catch(() => { /* best-effort */ });

        console.log(
            clc.green.bold("[ INFO ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` WhatsApp connected: ${connection.phoneNumber || '(unknown)'}`)
        );
    });

    connection.on('loggedOut', () => {
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.red(` WhatsApp logged out. Please restart and re-scan QR.`)
        );
    });

    // Mark ready immediately so /ready returns 200; pairing/connection state
    // is reflected via /api/bots/:id and /ws/qr/:botId.
    shutdownState.setReady();

    // Start API server — exposes pairing endpoints (QR WebSocket + pairing
    // code) and broadcast API for the lone connection.
    const { startServer } = require('./src/api/server');
    const apiPort = parseInt(process.env.API_PORT || '3000');
    const apiServer = await startServer(null, apiPort, { singleConnection: connection });

    // Auto-resume: if a previous pairing wrote auth creds, reconnect on boot.
    // Mirrors POST /api/bots/single/reactivate so the bot survives PM2/Docker
    // restarts without manual API calls. Skip when SINGLE_AUTO_RECONNECT=false
    // or when no creds exist (fresh install → wait for POST /api/bots/create).
    const autoReconnectEnabled = (process.env.SINGLE_AUTO_RECONNECT ?? 'true').toLowerCase() !== 'false';
    let autoStarted = false;
    if (autoReconnectEnabled) {
        try {
            const WaAuthState = require('./src/database/models/waAuthStateModel');
            const credsDoc = await WaAuthState.findOne({
                botId: 'single',
                dataType: 'creds',
                dataKey: 'main'
            }).lean();
            if (credsDoc && singleBotDoc?.isActive !== false) {
                connection.start().catch((err) => {
                    console.error(
                        clc.red.bold("[ ERROR ]") +
                        ` [${moment().format('HH:mm:ss')}]:` +
                        clc.red(` Auto-reconnect failed: ${err.message}`)
                    );
                });
                autoStarted = true;
                console.log(
                    clc.green.bold("[ INFO ]") +
                    ` [${moment().format('HH:mm:ss')}]:` +
                    clc.blueBright(' Auto-reconnecting using stored credentials...')
                );
            }
        } catch (err) {
            console.error(
                clc.yellow.bold("[ WARN ]") +
                ` [${moment().format('HH:mm:ss')}]:` +
                clc.yellow(` Auto-reconnect probe failed: ${err.message}`)
            );
        }
    }

    if (!autoStarted) {
        console.log(
            clc.yellow.bold("[ INFO ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(' Connection idle. POST /api/bots/create to start pairing or /api/bots/single/reactivate if creds exist.')
        );
    }

    // Start transaction processing interval
    const ProcessingTransaction = require('./ProcessTransaction');
    let txProcessing = false;
    const txIntervalId = setInterval(async () => {
        if (!txProcessing && connection.sock) {
            txProcessing = true;
            try {
                await ProcessingTransaction(connection.sock);
            } catch (err) {
                console.error(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: TX processing error: ${err.message}`);
            }
            txProcessing = false;
        }
    }, 3_000);

    // Graceful shutdown
    const { drainAllQueues } = require('./src/services/webhookNotificationService');
    const gracePeriodMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000');
    let shuttingDown = false;

    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(clc.yellow.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]: Graceful shutdown initiated (timeout ${gracePeriodMs}ms)`);

        const forceTimer = setTimeout(() => {
            console.log(clc.red.bold("[ WARN ]") + ` Drain timeout exceeded, forcing exit`);
            process.exit(1);
        }, gracePeriodMs);
        forceTimer.unref();

        shutdownState.setDraining();

        // Stop transaction processing
        clearInterval(txIntervalId);

        // Disconnect WhatsApp (preserves session)
        await connection.disconnect();

        // Flush in-flight webhook deliveries so audit logs aren't truncated.
        const { drained, pending } = await drainAllQueues(Math.max(5_000, gracePeriodMs / 2));
        if (!drained) {
            console.log(clc.yellow.bold("[ WARN ]") + ` Webhook queue still has ${pending} pending deliveries at shutdown`);
        }

        // Close API server last so /health stays responsive while draining.
        await apiServer.close();

        clearTimeout(forceTimer);
        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]: Clean shutdown complete`);
        process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

/**
 * Run in MULTI mode — multiple WhatsApp numbers from database
 */
async function runMultiMode() {
    const WaBotManager = require('./src/core/WaBotManager');
    const { EncryptionService } = require('./src/whatsapp/authEncryption');
    const shutdownState = require('./src/services/shutdownState');

    // Initialize auth encryption
    EncryptionService.initialize(process.env.WA_AUTH_ENCRYPTION_KEY);

    // Create message router factory
    const setupWhatsAppFn = require('./src/config/waSetup');

    // Set global message handler
    WaBotManager.setMessageHandler(async (sock, msg, botId) => {
        // Each bot gets its own router for botId-scoped middleware
        // Cache routers to avoid re-creation on every message
        if (!WaBotManager._routers) WaBotManager._routers = new Map();

        let router = WaBotManager._routers.get(botId);
        if (!router) {
            router = setupWhatsAppFn(botId);
            WaBotManager._routers.set(botId, router);
        }

        const ctx = new WaCtx(sock, msg, botId);
        try {
            // Humanize: random delay before reading (humans don't read instantly)
            await humanDelay(400, 1500);
            await ctx.markRead();

            // Small pause after reading before "thinking" and replying
            await humanDelay(200, 800);
            await router.route(ctx);
        } catch (err) {
            console.error(
                clc.red.bold("[ ERROR ]") +
                ` [${moment().format('HH:mm:ss')}]:` +
                clc.red(` Handler error (bot ${botId}): ${err.message}`)
            );
        }
    });

    // Initialize all bots (loads from database, starts connections)
    await WaBotManager.initialize(10); // Batch size 10 for WhatsApp (more conservative than Telegram)

    // Start API server
    const { startServer } = require('./src/api/server');
    const apiPort = parseInt(process.env.API_PORT || '3000');
    const apiServer = await startServer(WaBotManager, apiPort);

    // Mark as ready
    shutdownState.setReady();

    // Start transaction processor for all bots
    const WaTransactionProcessor = require('./src/core/WaTransactionProcessor');
    const txProcessor = new WaTransactionProcessor(WaBotManager);
    txProcessor.start(3000);

    // Graceful shutdown — dynamic timeout scales with bot count so a 100-bot
    // fleet has time to disconnect cleanly without the hard 10s cap killing
    // mid-flight webhook deliveries.
    const { drainAllQueues } = require('./src/services/webhookNotificationService');
    const baseTimeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000');
    let shuttingDown = false;

    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;

        const botCount = WaBotManager.bots.size;
        // 200ms per bot for disconnect + webhook flush, capped at 5 minutes.
        const dynamicTimeoutMs = process.env.SHUTDOWN_TIMEOUT_MS
            ? baseTimeoutMs
            : Math.min(baseTimeoutMs + botCount * 200, 5 * 60_000);

        console.log(clc.yellow.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]: Graceful shutdown initiated (${botCount} bots, timeout ${dynamicTimeoutMs}ms)`);

        const forceTimer = setTimeout(() => {
            console.log(clc.red.bold("[ WARN ]") + ` Drain timeout (${dynamicTimeoutMs}ms) exceeded, forcing exit. In-flight deliveries may be lost.`);
            process.exit(1);
        }, dynamicTimeoutMs);
        forceTimer.unref();

        shutdownState.setDraining();

        // 1. Stop new transaction work
        txProcessor.stop();
        await txProcessor.waitForDrain();

        // 2. Disconnect bots (fires bot_disconnected webhook events)
        await WaBotManager.shutdown();

        // 3. Drain pending webhook deliveries so audit log isn't truncated.
        const webhookDrainBudget = Math.max(5_000, Math.floor(dynamicTimeoutMs / 3));
        const { drained, pending } = await drainAllQueues(webhookDrainBudget);
        if (!drained) {
            console.log(clc.yellow.bold("[ WARN ]") + ` Webhook queue still has ${pending} pending deliveries; will be retried on next start? No — they are lost.`);
        }

        // 4. Close API server
        await apiServer.close();

        clearTimeout(forceTimer);
        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]: Clean shutdown complete`);
        process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

// Global error handlers
process.on('unhandledRejection', (reason) => {
    console.error(clc.red('[CRITICAL] Unhandled Promise Rejection:'), reason);
});

process.on('uncaughtException', (error) => {
    console.error(clc.red('[CRITICAL] Uncaught Exception:'), error);
});

// Run main
main();
