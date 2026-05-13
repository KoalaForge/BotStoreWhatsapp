const fastify = require('fastify');
const clc = require('cli-color');
const moment = require('moment-timezone');
const shutdownState = require('../services/shutdownState');

/**
 * Create and configure Fastify server for WhatsApp bot platform.
 * Works for both SINGLE mode (health-only) and MULTI mode (full API + health).
 *
 * @param {Object|null} waBotManager - WaBotManager instance (null for SINGLE mode)
 * @param {Object} [options={}]
 * @returns {FastifyInstance}
 */
function createServer(waBotManager, options = {}) {
    const app = fastify({
        logger: false,
        trustProxy: true,
        bodyLimit: 1048576 // 1MB
    });

    // Register WebSocket plugin
    app.register(require('@fastify/websocket'));

    // Reject non-health requests when draining (both modes)
    app.addHook('onRequest', async (request, reply) => {
        if (!shutdownState.isShuttingDown()) return;
        if (request.url === '/health' || request.url === '/ready') return;
        reply.code(503).send({ success: false, message: 'Server is shutting down' });
    });

    // Health & readiness routes (both modes, no auth)
    app.register(require('./routes/healthRoutes'), { waBotManager });

    // API docs route (self-contained auth via cookie, registered before apiAuth)
    app.register(require('./routes/docsRoutes'));

    // API middleware
    app.register(require('./middleware/errorHandler'));
    app.register(require('./middleware/apiAuth'));

    if (waBotManager) {
        // MULTI mode: full API routes
        app.register(require('./routes/index'), {
            prefix: '/api',
            waBotManager: waBotManager
        });

        // WebSocket routes for QR streaming (no API key auth - skipped by /ws/ prefix)
        app.register(require('./routes/wsRoutes'), {
            prefix: '/ws',
            waBotManager: waBotManager
        });
    } else if (options.singleConnection) {
        // SINGLE mode: same paths as MULTI (/api/bots, /ws/qr/:botId) backed
        // by the lone env-driven WaConnection. Mode is detected via env so
        // clients call the same endpoints regardless of deployment shape.
        app.register(require('./routes/singleRoutes'), {
            prefix: '/api/bots',
            connection: options.singleConnection
        });

        app.register(require('./routes/singleWsRoutes'), {
            prefix: '/ws',
            connection: options.singleConnection
        });
    }

    // Broadcast API — both SINGLE and MULTI mode
    app.register(require('./routes/broadcastRoutes'), {
        prefix: '/api/broadcast',
        waBotManager: waBotManager ?? null,
        singleConnection: options.singleConnection ?? null
    });

    return app;
}

/**
 * Start API server
 * @param {Object|null} waBotManager - WaBotManager instance (null for SINGLE mode)
 * @param {number} [port=3000] - Port to listen on
 * @param {Object} [options={}]
 * @returns {Promise<FastifyInstance>}
 */
async function startServer(waBotManager, port = 3000, options = {}) {
    const app = createServer(waBotManager, options);

    try {
        await app.listen({
            port: port,
            host: process.env.API_HOST || '0.0.0.0'
        });

        console.log(
            clc.green.bold("[ INFO ]") +
            ` [${moment().format('HH:mm:ss')}]:` +
            clc.blueBright(` API server running on http://0.0.0.0:${port}`)
        );

        return app;
    } catch (error) {
        console.error(clc.red.bold("[ ERROR ]") + ` Failed to start API server: ${error.message}`);
        throw error;
    }
}

module.exports = {
    createServer,
    startServer
};
