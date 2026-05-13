const {
    createBotController,
    updateBotController,
    deleteBotController,
    deactivateBotController,
    reactivateBotController,
    listBotsController,
    getBotController,
    requestPairingCodeController,
    listWebhookLogsController
} = require('../controllers/bot');
const schemas = require('../schemas/botSchemas');

/**
 * WhatsApp bot management routes
 * @param {FastifyInstance} fastify
 * @param {Object} options
 */
async function botRoutes(fastify, options) {
    const waBotManager = options.waBotManager;

    // Create bot (initiates pairing)
    fastify.post('/create', {
        schema: schemas.createBotSchema
    }, createBotController(waBotManager));

    // Update bot name
    fastify.patch('/:id', {
        schema: schemas.updateBotSchema
    }, updateBotController(waBotManager));

    // Delete bot
    fastify.delete('/:id', {
        schema: schemas.botIdParamSchema
    }, deleteBotController(waBotManager));

    // Deactivate bot (disconnect, preserve session)
    fastify.post('/:id/deactivate', {
        schema: schemas.botIdParamSchema
    }, deactivateBotController(waBotManager));

    // Reactivate bot (reconnect)
    fastify.post('/:id/reactivate', {
        schema: schemas.botIdParamSchema
    }, reactivateBotController(waBotManager));

    // Request new pairing code for existing bot
    fastify.post('/:id/pairing-code', {
        schema: schemas.pairingCodeSchema
    }, requestPairingCodeController(waBotManager));

    // List bots
    fastify.get('/', {
        schema: schemas.listBotsQuerySchema
    }, listBotsController(waBotManager));

    // Get bot details
    fastify.get('/:id', {
        schema: schemas.botIdParamSchema
    }, getBotController(waBotManager));

    // List webhook delivery logs for a bot (audit trail)
    fastify.get('/:id/webhook-logs', {
        schema: schemas.listWebhookLogsSchema
    }, listWebhookLogsController(waBotManager));
}

module.exports = botRoutes;
