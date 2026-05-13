const shutdownState = require('../../services/shutdownState');
const modeService = require('../../services/modeService');
const moment = require('moment-timezone');

/**
 * Health & readiness routes (no auth required).
 * Registered at root level - serves /health and /ready.
 *
 * @param {FastifyInstance} fastify
 * @param {Object} options
 * @param {Object|null} options.waBotManager
 */
async function healthRoutes(fastify, options) {
    const { waBotManager } = options;

    // Liveness - 200 as long as the process is alive
    fastify.get('/health', async () => {
        const data = {
            status: 'healthy',
            mode: modeService.getMode().toLowerCase(),
            timestamp: moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
            uptime: Math.floor(process.uptime())
        };

        if (waBotManager) {
            data.runningBots = waBotManager.getAllBots().length;
        }

        return { success: true, code: 200, message: 'API is running', data };
    });

    // Readiness - 503 during drain or when not yet ready
    fastify.get('/ready', async (request, reply) => {
        if (shutdownState.isShuttingDown()) {
            reply.code(503);
            return { status: 'draining', ready: false };
        }

        // MULTI mode: ready once WaBotManager is passed (initialized)
        if (waBotManager) {
            return {
                status: 'ready',
                ready: true,
                runningBots: waBotManager.getAllBots().length,
                uptime: Math.floor(process.uptime())
            };
        }

        // SINGLE mode: ready after bot starts
        if (!shutdownState.isReady()) {
            reply.code(503);
            return { status: 'starting', ready: false };
        }

        return { status: 'ready', ready: true, uptime: Math.floor(process.uptime()) };
    });
}

module.exports = healthRoutes;
