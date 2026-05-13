/**
 * Fastify JSON Schema validation for broadcast API endpoints (WhatsApp).
 */

const sendBroadcastSchema = {
    body: {
        type: 'object',
        properties: {
            bot_id:    { type: 'string', maxLength: 50 },                  // Required in MULTI, ignored in SINGLE
            text:      { type: 'string', minLength: 1, maxLength: 4096 },  // Message text or image caption
            image_url: { type: 'string', minLength: 1, maxLength: 2048 }   // Public image URL
        },
        additionalProperties: false
        // Either 'text' or 'image_url' must be provided — validated in controller
    }
};

const broadcastStatusSchema = {
    params: {
        type: 'object',
        required: ['jobId'],
        properties: {
            jobId: { type: 'string', minLength: 16, maxLength: 16 } // 16 hex chars (8 bytes)
        }
    }
};

module.exports = { sendBroadcastSchema, broadcastStatusSchema };
