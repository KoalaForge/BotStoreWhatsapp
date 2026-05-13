/**
 * Process Payment Controller (WhatsApp)
 * Handles POST /api/transactions/process-payment
 * Called by koalabotbe (Laravel) after it validates a payment webhook.
 */

const waPaymentTriggerService = require('../../../services/waPaymentTriggerService');

const STATUS_MESSAGES = {
    already_processed: 'Transaction already processed',
    paid_pending_delivery: 'Payment recorded, delivery pending bot availability',
    delivered: 'Transaction processed and delivered',
    paid_delivery_pending: 'Payment recorded, delivery will be retried by polling',
};

function processPaymentController(waBotManager) {
    return async (request, reply) => {
        const { transaction_id, paid_at, payment_id, amount } = request.body;

        const result = await waPaymentTriggerService.processPayment({
            transactionId: transaction_id,
            paidAt: paid_at,
            paymentId: payment_id,
            amount,
        }, waBotManager);

        return reply.code(200).send({
            success: true,
            code: 200,
            message: STATUS_MESSAGES[result.status],
            data: { transaction_id, status: result.status },
        });
    };
}

module.exports = processPaymentController;
