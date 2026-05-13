const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');
const { NotFoundException } = require('../../../exceptions');

/**
 * Get Bot Controller
 * Handles GET /api/bots/:id
 */
function getBotController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        const bot = await userWhatsappBotModel.findById(botId);
        if (!bot) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        // Get runtime information if bot connection is active
        const connection = waBotManager.getBotInstance(botId);
        const runtimeInfo = connection ? {
            is_running: connection.isRunning,
            started_at: connection.startedAt
        } : null;

        const botData = bot.toObject();

        return {
            success: true,
            code: 200,
            message: 'Bot retrieved successfully',
            data: {
                bot_id: botData._id.toString(),
                user_id: botData.userId,
                phone_number: botData.phoneNumber,
                bot_name: botData.botName,
                pairing_method: botData.pairingMethod,
                is_active: botData.isActive,
                is_suspended: botData.isSuspended,
                webhook_url: botData.webhook_url || null,
                connection_state: botData.connection_state || 'idle',
                last_state_change_at: botData.last_state_change_at || null,
                last_connected_at: botData.lastConnectedAt,
                created_at: botData.createdAt,
                updated_at: botData.updatedAt,
                runtime: runtimeInfo
            }
        };
    };
}

module.exports = getBotController;
