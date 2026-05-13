const crypto = require('crypto');
const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');

/**
 * Update Bot Controller
 * Handles PATCH /api/bots/:id
 * Mutable fields: bot_name, webhook_url, webhook_events.
 * Rotates webhook_secret whenever webhook_url changes.
 */
function updateBotController(waBotManager) {
    return async (request, reply) => {
        const { id } = request.params;
        const { bot_name, webhook_url, webhook_events } = request.body;

        // Decide whether to rotate the webhook secret. Rotation happens when
        // webhook_url is added, changed, or cleared. Clearing the URL also
        // wipes the secret so a stale value isn't returned later.
        let rotatedSecret;
        let secretToWrite;
        if (webhook_url !== undefined) {
            const existing = await userWhatsappBotModel.findById(id);
            const newUrl = webhook_url || null;
            const oldUrl = existing?.webhook_url || null;
            if (newUrl !== oldUrl) {
                if (newUrl) {
                    rotatedSecret = crypto.randomBytes(32).toString('hex');
                    secretToWrite = rotatedSecret;
                } else {
                    secretToWrite = null;
                }
            }
        }

        const bot = await waBotManager.updateBot({
            botId: id,
            botName: bot_name,
            webhookUrl: webhook_url,
            webhookEvents: webhook_events,
            webhookSecret: secretToWrite
        });

        const responseData = {
            bot_id: bot._id.toString(),
            user_id: bot.userId,
            phone_number: bot.phoneNumber,
            bot_name: bot.botName,
            is_active: bot.isActive,
            is_suspended: bot.isSuspended,
            webhook_url: bot.webhook_url || null,
            webhook_events: bot.webhook_events,
            updated_at: bot.updatedAt
        };

        // Only include the secret when it was just rotated.
        if (rotatedSecret) {
            responseData.webhook_secret = rotatedSecret;
        }

        return {
            success: true,
            code: 200,
            message: 'Bot updated successfully',
            data: responseData
        };
    };
}

module.exports = updateBotController;
