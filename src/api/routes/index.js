const modeService = require('../../services/modeService');

/**
 * API routes aggregator
 */
async function routes(fastify, options) {
    // Register bot management routes
    fastify.register(require('./botRoutes'), {
        prefix: '/bots',
        waBotManager: options.waBotManager
    });

    // Transaction trigger routes (MULTI mode only)
    // Called by koalabotbe to trigger delivery after payment validation
    if (modeService.isMultiMode()) {
        fastify.register(require('./transactionRoutes'), {
            prefix: '/transactions',
            waBotManager: options.waBotManager
        });
    }
}

module.exports = routes;
