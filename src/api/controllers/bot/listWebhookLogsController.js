const webhookDeliveryLogModel = require('../../../database/models/webhookDeliveryLogModels');
const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');
const { NotFoundException } = require('../../../exceptions');

/**
 * List Webhook Delivery Logs
 * Handles GET /api/bots/:id/webhook-logs
 * Returns the audit trail of webhook delivery attempts for a single bot.
 */
function listWebhookLogsController() {
    return async (request, reply) => {
        const { id: botId } = request.params;
        const { status, event, page = 1, limit = 20 } = request.query;

        const botExists = await userWhatsappBotModel.exists({ _id: botId });
        if (!botExists) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        const filter = { bot_id: botId };
        if (status) filter.status = status;
        if (event) filter.event = event;

        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            webhookDeliveryLogModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            webhookDeliveryLogModel.countDocuments(filter)
        ]);

        return {
            success: true,
            code: 200,
            message: 'Webhook delivery logs retrieved successfully',
            data: {
                logs: logs.map(l => ({
                    id: l._id.toString(),
                    envelope_id: l.envelope_id,
                    event: l.event,
                    url: l.url,
                    status: l.status,
                    attempts: l.attempts,
                    response_code: l.response_code,
                    response_body: l.response_body,
                    last_attempt_at: l.last_attempt_at,
                    created_at: l.createdAt,
                    payload: l.payload
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            }
        };
    };
}

module.exports = listWebhookLogsController;
