/**
 * Transaction API routes (WhatsApp)
 * Called by koalabotbe (Laravel) to trigger transaction processing.
 * Uses existing apiAuth middleware (X-API-Key header).
 */

const { processPaymentController } = require('../controllers/transaction');
const { processPaymentSchema } = require('../schemas/transactionSchemas');

async function transactionRoutes(fastify, options) {
    const waBotManager = options.waBotManager;

    // POST /api/transactions/process-payment
    // Triggered by koalabotbe after validating payment from gateway
    fastify.post('/process-payment', {
        schema: processPaymentSchema
    }, processPaymentController(waBotManager));
}

module.exports = transactionRoutes;
