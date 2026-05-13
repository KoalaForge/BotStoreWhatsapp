const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');

/**
 * List Bots Controller
 * Handles GET /api/bots
 */
function listBotsController(waBotManager) {
    return async (request, reply) => {
        const { user_id, is_active, is_suspended, page = 1, limit = 20 } = request.query;

        const filter = {};
        if (user_id) filter.userId = user_id;
        if (is_active !== undefined) filter.isActive = is_active;
        if (is_suspended !== undefined) filter.isSuspended = is_suspended;

        const skip = (page - 1) * limit;

        const [bots, total] = await Promise.all([
            userWhatsappBotModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            userWhatsappBotModel.countDocuments(filter)
        ]);

        const botsWithStatus = bots.map(bot => {
            const connection = waBotManager.getBotInstance(bot._id.toString());
            return {
                bot_id: bot._id.toString(),
                user_id: bot.userId,
                phone_number: bot.phoneNumber,
                bot_name: bot.botName,
                pairing_method: bot.pairingMethod,
                is_active: bot.isActive,
                is_suspended: bot.isSuspended,
                webhook_url: bot.webhook_url || null,
                connection_state: bot.connection_state || 'idle',
                last_state_change_at: bot.last_state_change_at || null,
                last_connected_at: bot.lastConnectedAt,
                created_at: bot.createdAt,
                updated_at: bot.updatedAt,
                is_running: connection ? connection.isRunning : false
            };
        });

        return {
            success: true,
            code: 200,
            message: 'Bots retrieved successfully',
            data: {
                bots: botsWithStatus,
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

module.exports = listBotsController;
