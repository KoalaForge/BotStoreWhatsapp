const {
    createBotController,
    updateBotController,
    deleteBotController,
    deactivateBotController,
    reactivateBotController,
    restartBotController,
    listBotsController,
    getBotController,
    requestPairingCodeController,
    requestQrController,
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

    // Restart bot (stop socket + reconnect with existing auth)
    fastify.post('/:id/restart', {
        schema: schemas.botIdParamSchema
    }, restartBotController(waBotManager));

    // Request new pairing code for existing bot
    fastify.post('/:id/pairing-code', {
        schema: schemas.pairingCodeSchema
    }, requestPairingCodeController(waBotManager));

    // Force fresh QR generation (fire-and-forget; delivery via webhook + WS)
    fastify.post('/:id/qr', {
        schema: schemas.botIdParamSchema
    }, requestQrController(waBotManager));

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
