/**
 * Fastify JSON Schema validation for transaction trigger endpoints.
 * Called by koalabotbe (Laravel) after it validates payment from gateway.
 */

const processPaymentSchema = {
    body: {
        type: 'object',
        required: ['transaction_id'],
        properties: {
            transaction_id: { type: 'string', minLength: 1, maxLength: 50 },
            paid_at: { type: 'string' },
            payment_id: { type: 'string', maxLength: 100 },
            amount: { type: 'number', minimum: 0 }
        },
        additionalProperties: false
    }
};

module.exports = { processPaymentSchema };
