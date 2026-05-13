/**
 * Broadcast API routes (WhatsApp)
 * Available in BOTH SINGLE and MULTI mode.
 * Uses existing apiAuth middleware (X-API-Key header).
 *
 * POST /api/broadcast/send   — enqueue a broadcast, returns jobId immediately
 * GET  /api/broadcast/:jobId — poll progress of a broadcast job
 */

const { sendBroadcastSchema, broadcastStatusSchema }  = require('../schemas/broadcastSchemas');
const { sendBroadcastController }                      = require('../controllers/broadcast/sendBroadcastController');
const { broadcastStatusController }                    = require('../controllers/broadcast/broadcastStatusController');

async function broadcastRoutes(fastify, options) {
    const { waBotManager, singleConnection } = options;

    // POST /api/broadcast/send
    fastify.post('/send', {
        schema: sendBroadcastSchema
    }, sendBroadcastController(waBotManager, singleConnection));

    // GET /api/broadcast/:jobId
    fastify.get('/:jobId', {
        schema: broadcastStatusSchema
    }, broadcastStatusController());
}

module.exports = broadcastRoutes;
