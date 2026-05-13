/**
 * Fastify validation schemas for WhatsApp bot endpoints
 */

const { ALLOWED_EVENTS } = require('../../services/webhookNotificationService');

const webhookUrlSchema = {
    type: 'string',
    format: 'uri',
    maxLength: 2048
};

const webhookEventsSchema = {
    type: 'array',
    items: { type: 'string', enum: ALLOWED_EVENTS },
    minItems: 1,
    uniqueItems: true
};

const createBotSchema = {
    body: {
        type: 'object',
        required: ['user_id', 'phone_number'],
        properties: {
            user_id: {
                type: 'string',
                minLength: 1
            },
            phone_number: {
                type: 'string',
                minLength: 10,
                maxLength: 15,
                pattern: '^[0-9]+$'
            },
            bot_name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            pairing_method: {
                type: 'string',
                enum: ['qr', 'code'],
                default: 'qr'
            },
            webhook_url: webhookUrlSchema,
            webhook_events: webhookEventsSchema
        }
    }
};

const botIdParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                minLength: 1
            }
        }
    }
};

const updateBotSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                minLength: 1
            }
        }
    },
    body: {
        type: 'object',
        properties: {
            bot_name: {
                type: 'string',
                minLength: 1,
                maxLength: 100
            },
            webhook_url: { ...webhookUrlSchema, nullable: true },
            webhook_events: webhookEventsSchema
        },
        minProperties: 1
    }
};

const listBotsQuerySchema = {
    querystring: {
        type: 'object',
        properties: {
            user_id: { type: 'string' },
            is_active: { type: 'boolean' },
            is_suspended: { type: 'boolean' },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
    }
};

const pairingCodeSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: {
                type: 'string',
                minLength: 1
            }
        }
    }
};

const listWebhookLogsSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', minLength: 1 }
        }
    },
    querystring: {
        type: 'object',
        properties: {
            status: { type: 'string', enum: ['pending', 'delivered', 'failed'] },
            event: { type: 'string', enum: ALLOWED_EVENTS.filter(e => e !== '*') },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
    }
};

module.exports = {
    createBotSchema,
    updateBotSchema,
    botIdParamSchema,
    listBotsQuerySchema,
    pairingCodeSchema,
    listWebhookLogsSchema
};
